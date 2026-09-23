package runtime

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

var (
	errTelemetryDisabled = errors.New("telemetry disabled")
	errQueueFull         = errors.New("local telemetry queue is full")
)

type Store struct {
	db       *sql.DB
	stateDir string
	mu       sync.Mutex
}

type sqlRunner interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func OpenStore(stateDir string) (*Store, error) {
	resolved, err := resolveStateDir(stateDir)
	if err != nil {
		return nil, err
	}
	if err := ensurePrivateDir(resolved); err != nil {
		return nil, err
	}
	dbPath := filepath.Join(resolved, "runtime.sqlite3")
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(dbPath)+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	store := &Store{db: db, stateDir: resolved}
	if err := store.init(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	for _, path := range []string{dbPath, dbPath + "-wal", dbPath + "-shm"} {
		if err := os.Chmod(path, privateFileMode()); err != nil && !errors.Is(err, os.ErrNotExist) {
			_ = db.Close()
			return nil, err
		}
	}
	return store, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) StateDir() string { return s.stateDir }

func (s *Store) init(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS origins (origin TEXT PRIMARY KEY, updated_at TEXT NOT NULL)`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("initialize runtime database: %w", err)
		}
	}
	if err := s.ensureSkillsSchema(ctx); err != nil {
		return fmt.Errorf("initialize runtime database: %w", err)
	}
	statements = []string{
		`CREATE TABLE IF NOT EXISTS skill_paths (path TEXT PRIMARY KEY, canonical_path TEXT NOT NULL REFERENCES skills(canonical_path) ON DELETE CASCADE, updated_at TEXT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS skill_paths_canonical_idx ON skill_paths(canonical_path)`,
		`CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, version TEXT NOT NULL, kind TEXT NOT NULL, adapter TEXT NOT NULL, observed_at TEXT NOT NULL, agent TEXT NOT NULL, environment TEXT NOT NULL, identity_json TEXT, endpoint TEXT NOT NULL, payload BLOB NOT NULL, payload_bytes INTEGER NOT NULL, local_key TEXT, session_id TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt TEXT, status TEXT NOT NULL DEFAULT 'pending', last_error TEXT, last_status INTEGER, sent_at TEXT)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS events_local_key_idx ON events(local_key) WHERE local_key IS NOT NULL AND local_key <> ''`,
		`CREATE INDEX IF NOT EXISTS events_pending_idx ON events(status, next_attempt, created_at)`,
		`CREATE TABLE IF NOT EXISTS diagnostics (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS diagnostics_code_idx ON diagnostics(code, created_at)`,
		`CREATE TABLE IF NOT EXISTS session_policies (session_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, source TEXT NOT NULL, updated_at TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS cursors (path TEXT PRIMARY KEY, file_id TEXT NOT NULL, offset INTEGER NOT NULL, initialized INTEGER NOT NULL, session_id TEXT NOT NULL DEFAULT '', agent TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS transcript_calls (call_key TEXT PRIMARY KEY, call_id TEXT NOT NULL, path TEXT NOT NULL, session_id TEXT NOT NULL, skill_ref TEXT NOT NULL, turn_id TEXT, version TEXT, updated_at TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS worker_lease (id INTEGER PRIMARY KEY CHECK (id = 1), owner TEXT NOT NULL, lease_until TEXT NOT NULL)`,
		`INSERT OR IGNORE INTO settings(key, value) VALUES ('telemetry_enabled', '1')`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("initialize runtime database: %w", err)
		}
	}
	if err := s.ensureCursorsSchema(ctx); err != nil {
		return fmt.Errorf("initialize runtime database: %w", err)
	}
	if err := s.ensureTranscriptCallsSchema(ctx); err != nil {
		return fmt.Errorf("initialize runtime database: %w", err)
	}
	return nil
}

// transcriptCallKey is the durable composite identity for a transcript tool
// call. Claude can reuse a call ID in another session (notably for subagents),
// so call_id alone must never select or overwrite another session's pending
// correlation record. The raw call_id remains stored for wire/local event
// correlation; this digest is only a bounded SQLite lookup key.
func transcriptCallKey(sessionID, callID string) string {
	digest := sha256.Sum256([]byte(sessionID + "\x1f" + callID))
	return hex.EncodeToString(digest[:])
}

// ensureTranscriptCallsSchema migrates the first-release table, whose primary
// key was call_id, to a physical composite lookup key while preserving all
// pending correlation records. DDL is transactional in SQLite, so a failed
// migration leaves the original table available on the next startup.
func (s *Store) ensureTranscriptCallsSchema(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(transcript_calls)`)
	if err != nil {
		return err
	}
	hasCallKey := false
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return err
		}
		if name == "call_key" {
			hasCallKey = true
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	_ = rows.Close()
	if hasCallKey {
		return nil
	}

	type transcriptCallRow struct {
		callID, path, sessionID, skillRef, turnID, version, updatedAt string
	}
	var calls []transcriptCallRow
	legacyRows, err := s.db.QueryContext(ctx, `SELECT call_id, path, session_id, skill_ref, COALESCE(turn_id, ''), COALESCE(version, ''), updated_at FROM transcript_calls`)
	if err != nil {
		return err
	}
	for legacyRows.Next() {
		var row transcriptCallRow
		if err := legacyRows.Scan(&row.callID, &row.path, &row.sessionID, &row.skillRef, &row.turnID, &row.version, &row.updatedAt); err != nil {
			_ = legacyRows.Close()
			return err
		}
		calls = append(calls, row)
	}
	if err := legacyRows.Err(); err != nil {
		_ = legacyRows.Close()
		return err
	}
	_ = legacyRows.Close()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	rollback := func() error {
		_ = tx.Rollback()
		return err
	}
	if _, err = tx.ExecContext(ctx, `ALTER TABLE transcript_calls RENAME TO transcript_calls_legacy`); err != nil {
		return rollback()
	}
	if _, err = tx.ExecContext(ctx, `CREATE TABLE transcript_calls (call_key TEXT PRIMARY KEY, call_id TEXT NOT NULL, path TEXT NOT NULL, session_id TEXT NOT NULL, skill_ref TEXT NOT NULL, turn_id TEXT, version TEXT, updated_at TEXT NOT NULL)`); err != nil {
		return rollback()
	}
	for _, row := range calls {
		if _, err = tx.ExecContext(ctx, `INSERT INTO transcript_calls(call_key, call_id, path, session_id, skill_ref, turn_id, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, transcriptCallKey(row.sessionID, row.callID), row.callID, row.path, row.sessionID, row.skillRef, row.turnID, row.version, row.updatedAt); err != nil {
			return rollback()
		}
	}
	if _, err = tx.ExecContext(ctx, `DROP TABLE transcript_calls_legacy`); err != nil {
		return rollback()
	}
	return tx.Commit()
}

// ensureCursorsSchema adds the session and agent associations introduced after
// the first runtime release. Existing cursor offsets remain intact, so
// enrollment never causes a transcript backfill.
func (s *Store) ensureCursorsSchema(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(cursors)`)
	if err != nil {
		return err
	}
	foundSession, foundAgent := false, false
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return err
		}
		if name == "session_id" {
			foundSession = true
		}
		if name == "agent" {
			foundAgent = true
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	_ = rows.Close()
	if !foundSession {
		if _, err := s.db.ExecContext(ctx, `ALTER TABLE cursors ADD COLUMN session_id TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	if !foundAgent {
		if _, err := s.db.ExecContext(ctx, `ALTER TABLE cursors ADD COLUMN agent TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	return nil
}

// ensureSkillsSchema keeps the installation identity at the canonical path.
// The same Skillpack skill ID can be installed in multiple directories and at
// multiple versions, so skill_id is deliberately not a database key.
func (s *Store) ensureSkillsSchema(ctx context.Context) error {
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='skills'`).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		_, err := s.db.ExecContext(ctx, `CREATE TABLE skills (skill_id TEXT NOT NULL, canonical_path TEXT NOT NULL UNIQUE, version TEXT NOT NULL, origin TEXT NOT NULL REFERENCES origins(origin), updated_at TEXT NOT NULL)`)
		return err
	}
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(skills)`)
	if err != nil {
		return err
	}
	legacyPrimaryKey := false
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, primaryKey int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return err
		}
		if name == "skill_id" && primaryKey != 0 {
			legacyPrimaryKey = true
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	_ = rows.Close()
	if !legacyPrimaryKey {
		return nil
	}

	type skillRow struct {
		id, path, version, origin, updatedAt string
	}
	var skills []skillRow
	skillRows, err := s.db.QueryContext(ctx, `SELECT skill_id, canonical_path, version, origin, updated_at FROM skills`)
	if err != nil {
		return err
	}
	for skillRows.Next() {
		var row skillRow
		if err := skillRows.Scan(&row.id, &row.path, &row.version, &row.origin, &row.updatedAt); err != nil {
			_ = skillRows.Close()
			return err
		}
		skills = append(skills, row)
	}
	if err := skillRows.Err(); err != nil {
		_ = skillRows.Close()
		return err
	}
	_ = skillRows.Close()

	type pathRow struct {
		path, canonical, updatedAt string
	}
	var paths []pathRow
	var pathTable int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='skill_paths'`).Scan(&pathTable); err != nil {
		return err
	}
	if pathTable != 0 {
		pathRows, queryErr := s.db.QueryContext(ctx, `SELECT path, canonical_path, updated_at FROM skill_paths`)
		if queryErr != nil {
			return queryErr
		}
		for pathRows.Next() {
			var row pathRow
			if scanErr := pathRows.Scan(&row.path, &row.canonical, &row.updatedAt); scanErr != nil {
				_ = pathRows.Close()
				return scanErr
			}
			paths = append(paths, row)
		}
		if err := pathRows.Err(); err != nil {
			_ = pathRows.Close()
			return err
		}
		_ = pathRows.Close()
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	rollback := func() error {
		_ = tx.Rollback()
		return err
	}
	if _, err = tx.ExecContext(ctx, `DROP TABLE IF EXISTS skill_paths`); err != nil {
		return rollback()
	}
	if _, err = tx.ExecContext(ctx, `CREATE TABLE skills_new (skill_id TEXT NOT NULL, canonical_path TEXT NOT NULL UNIQUE, version TEXT NOT NULL, origin TEXT NOT NULL REFERENCES origins(origin), updated_at TEXT NOT NULL)`); err != nil {
		return rollback()
	}
	for _, row := range skills {
		if _, err = tx.ExecContext(ctx, `INSERT INTO skills_new(skill_id, canonical_path, version, origin, updated_at) VALUES (?, ?, ?, ?, ?)`, row.id, row.path, row.version, row.origin, row.updatedAt); err != nil {
			return rollback()
		}
	}
	if _, err = tx.ExecContext(ctx, `DROP TABLE skills`); err != nil {
		return rollback()
	}
	if _, err = tx.ExecContext(ctx, `ALTER TABLE skills_new RENAME TO skills`); err != nil {
		return rollback()
	}
	if _, err = tx.ExecContext(ctx, `CREATE TABLE skill_paths (path TEXT PRIMARY KEY, canonical_path TEXT NOT NULL REFERENCES skills(canonical_path) ON DELETE CASCADE, updated_at TEXT NOT NULL)`); err != nil {
		return rollback()
	}
	knownPaths := make(map[string]struct{}, len(skills))
	for _, row := range skills {
		knownPaths[row.path] = struct{}{}
	}
	for _, row := range paths {
		if _, ok := knownPaths[row.canonical]; !ok {
			continue
		}
		if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO skill_paths(path, canonical_path, updated_at) VALUES (?, ?, ?)`, row.path, row.canonical, row.updatedAt); err != nil {
			return rollback()
		}
	}
	return tx.Commit()
}

func nowUTC() time.Time { return time.Now().UTC().Truncate(time.Millisecond) }

// formatTime keeps fixed millisecond precision so SQLite TEXT comparisons
// retain chronological order. RFC3339Nano omits trailing zeroes (for example
// .82Z), which can make an earlier timestamp sort after .821Z.
func formatTime(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func parseStoredTime(value string) time.Time {
	t, _ := time.Parse(time.RFC3339Nano, value)
	return t
}

func (s *Store) addDiagnostic(code, message string) {
	insertDiagnostic(context.Background(), s.db, code, message)
}

// pruneBoundedState keeps local tombstones and correlation metadata bounded.
// Terminal events retain their local key for deduplication, but no longer
// retain the wire payload or endpoint after delivery/terminal failure.
func (s *Store) pruneBoundedState(ctx context.Context) error {
	cutoff := formatTime(nowUTC().Add(-EventTTL))
	// Terminal rows are deduplication tombstones only. Clear any payload left
	// by an older runtime before applying the row and age bounds.
	if _, err := s.db.ExecContext(ctx, `UPDATE events SET payload=?, payload_bytes=0, identity_json=NULL, endpoint='' WHERE status IN ('sent', 'dead')`, []byte{}); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM events WHERE status IN ('sent', 'dead') AND created_at < ?`, cutoff); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM transcript_calls WHERE updated_at < ?`, cutoff); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM diagnostics WHERE created_at < ?`, cutoff); err != nil {
		return err
	}
	var pending int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM events WHERE status='pending'`).Scan(&pending); err != nil {
		return err
	}
	terminalLimit := MaxQueueEvents - pending
	if terminalLimit < 0 {
		terminalLimit = 0
	}
	if err := s.trimRowsByCount(ctx, `events`, `event_id`, `created_at`, terminalLimit, `status IN ('sent', 'dead')`); err != nil {
		return err
	}
	if err := s.trimRowsByCount(ctx, `transcript_calls`, `call_key`, `updated_at`, MaxQueueEvents, `1=1`); err != nil {
		return err
	}
	if err := s.trimRowsByCount(ctx, `session_policies`, `session_id`, `updated_at`, MaxQueueEvents, `1=1`); err != nil {
		return err
	}
	if err := s.trimRowsByCount(ctx, `cursors`, `path`, `updated_at`, MaxQueueEvents, `1=1`); err != nil {
		return err
	}
	return s.trimRowsByCount(ctx, `diagnostics`, `id`, `created_at`, MaxQueueEvents, `1=1`)
}

func (s *Store) trimRowsByCount(ctx context.Context, table, idColumn, orderColumn string, limit int, predicate string) error {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+table+` WHERE `+predicate).Scan(&count); err != nil {
		return err
	}
	if count <= limit {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM `+table+` WHERE `+idColumn+` IN (SELECT `+idColumn+` FROM `+table+` WHERE `+predicate+` ORDER BY `+orderColumn+` ASC, `+idColumn+` ASC LIMIT ?)`, count-limit)
	return err
}

func insertDiagnostic(ctx context.Context, runner sqlRunner, code, message string) {
	if len(message) > maxDiagnosticMessage {
		message = message[:maxDiagnosticMessage]
	}
	_, _ = runner.ExecContext(ctx, `INSERT INTO diagnostics(code, message, created_at) VALUES (?, ?, ?)`, code, message, formatTime(nowUTC()))
}

func (s *Store) telemetryEnabled(ctx context.Context) (bool, error) {
	return telemetryEnabledWith(ctx, s.db)
}

func telemetryEnabledWith(ctx context.Context, runner sqlRunner) (bool, error) {
	var value string
	err := runner.QueryRowContext(ctx, `SELECT value FROM settings WHERE key='telemetry_enabled'`).Scan(&value)
	if err != nil {
		return false, err
	}
	return value == "1", nil
}

func (s *Store) setTelemetry(ctx context.Context, enabled bool) error {
	value := "0"
	if enabled {
		value = "1"
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO settings(key, value) VALUES ('telemetry_enabled', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, value); err != nil {
		return err
	}
	if !enabled {
		if _, err := s.db.ExecContext(ctx, `DELETE FROM events`); err != nil {
			return err
		}
		if _, err := s.db.ExecContext(ctx, `DELETE FROM transcript_calls`); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) rememberSession(ctx context.Context, sessionID string, enabled bool, source string) error {
	return rememberSessionWith(ctx, s.db, sessionID, enabled, source)
}

func rememberSessionWith(ctx context.Context, runner sqlRunner, sessionID string, enabled bool, source string) error {
	if strings.TrimSpace(sessionID) == "" {
		return nil
	}
	value := 0
	if enabled {
		value = 1
	}
	_, err := runner.ExecContext(ctx, `INSERT INTO session_policies(session_id, enabled, source, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET enabled=excluded.enabled, source=excluded.source, updated_at=excluded.updated_at`, sessionID, value, source, formatTime(nowUTC()))
	return err
}

func (s *Store) sessionAllowed(ctx context.Context, sessionID string) (bool, bool, error) {
	return sessionAllowedWith(ctx, s.db, sessionID)
}

func sessionAllowedWith(ctx context.Context, runner sqlRunner, sessionID string) (bool, bool, error) {
	if strings.TrimSpace(sessionID) == "" {
		return true, true, nil
	}
	var enabled int
	err := runner.QueryRowContext(ctx, `SELECT enabled FROM session_policies WHERE session_id=?`, sessionID).Scan(&enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	return enabled == 1, true, nil
}

func (s *Store) purgeSession(ctx context.Context, sessionID string) error {
	return purgeSessionWith(ctx, s.db, sessionID)
}

func purgeSessionWith(ctx context.Context, runner sqlRunner, sessionID string) error {
	if strings.TrimSpace(sessionID) == "" {
		return nil
	}
	_, err := runner.ExecContext(ctx, `DELETE FROM events WHERE session_id=?`, sessionID)
	return err
}

func (s *Store) diagnosticSummaries(ctx context.Context) ([]DiagnosticSummary, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT code, message, COUNT(*), MAX(created_at) FROM diagnostics GROUP BY code, message ORDER BY MAX(created_at) DESC LIMIT 50`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []DiagnosticSummary
	for rows.Next() {
		var item DiagnosticSummary
		if err := rows.Scan(&item.Code, &item.Message, &item.Count, &item.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func marshalIdentity(identity *Identity) (string, error) {
	if identity == nil {
		return "", nil
	}
	b, err := json.Marshal(identity)
	return string(b), err
}
