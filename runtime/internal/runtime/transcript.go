package runtime

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type transcriptPath struct {
	path  string
	agent string
}

type transcriptCall struct {
	CallID    string
	SkillRef  string
	SessionID string
	TurnID    string
	Version   string
}

func sessionIDFromPath(path string) string {
	base := filepath.Base(path)
	for _, suffix := range []string{".jsonl", ".json", ".log"} {
		base = strings.TrimSuffix(base, suffix)
	}
	return strings.TrimSpace(base)
}

func discoverTranscriptSession(path, fallback string) string {
	file, err := os.Open(path)
	if err != nil {
		return fallback
	}
	defer file.Close()
	buffer := make([]byte, 64*1024)
	read, err := file.Read(buffer)
	if err != nil && read == 0 {
		return fallback
	}
	line := buffer[:read]
	if newline := strings.IndexByte(string(line), '\n'); newline >= 0 {
		line = line[:newline]
	}
	var object map[string]any
	if json.Unmarshal(line, &object) != nil {
		return fallback
	}
	if value := transcriptSessionField(object); value != "" {
		return value
	}
	return fallback
}

func transcriptSessionField(object map[string]any) string {
	if value := stringField(object, "session_id", "sessionId", "conversation_id", "thread_id", "threadId"); value != "" {
		return value
	}
	for _, key := range []string{"payload", "message", "item", "data"} {
		if nested, ok := object[key].(map[string]any); ok {
			if value := transcriptSessionField(nested); value != "" {
				return value
			}
		}
	}
	return ""
}

const transcriptAnchorSize int64 = 4096

// transcriptAnchor fingerprints only the bounded bytes immediately before a
// cursor. Appending records leaves this anchor stable, while replacing a file
// in place with the same or a larger size changes it before we seek and avoids
// silently skipping the replacement prefix.
func transcriptAnchor(path string, offset int64) (string, error) {
	if offset < 0 {
		offset = 0
	}
	start := offset - transcriptAnchorSize
	if start < 0 {
		start = 0
	}
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	if _, err := file.Seek(start, io.SeekStart); err != nil {
		return "", err
	}
	data, err := io.ReadAll(io.LimitReader(file, offset-start))
	if err != nil {
		return "", err
	}
	if int64(len(data)) != offset-start {
		return "", io.ErrUnexpectedEOF
	}
	digest := sha256.Sum256(data)
	return "anchor:" + hex.EncodeToString(digest[:]), nil
}

// reassignTranscriptCursor binds a reused host path to the current session.
// A disabled or unknown session is still assigned an EOF cursor, but no
// transcript bytes are read while revoking the previous owner.
func (s *Store) reassignTranscriptCursor(ctx context.Context, path, sessionID, agent string, readAnchor bool) error {
	stat, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		_, err = s.db.ExecContext(ctx, `INSERT INTO cursors(path, file_id, offset, initialized, session_id, agent, updated_at) VALUES (?, '', 0, 0, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET file_id='', offset=0, initialized=0, session_id=excluded.session_id, agent=excluded.agent, updated_at=excluded.updated_at`, path, sessionID, agent, formatTime(nowUTC()))
		return err
	}
	if err != nil {
		return err
	}
	if !stat.Mode().IsRegular() {
		return errors.New("transcript path is not a regular file")
	}
	var currentSession, currentAgent string
	err = s.db.QueryRowContext(ctx, `SELECT session_id, agent FROM cursors WHERE path=?`, path).Scan(&currentSession, &currentAgent)
	if errors.Is(err, sql.ErrNoRows) {
		// Continue with a fresh EOF baseline below.
	} else if err != nil {
		return err
	} else if currentSession == sessionID && currentAgent == agent {
		return nil
	}
	fileID := ""
	if readAnchor {
		fileID, err = transcriptAnchor(path, stat.Size())
		if err != nil {
			return err
		}
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO cursors(path, file_id, offset, initialized, session_id, agent, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET file_id=excluded.file_id, offset=excluded.offset, initialized=1, session_id=excluded.session_id, agent=excluded.agent, updated_at=excluded.updated_at`, path, fileID, stat.Size(), sessionID, agent, formatTime(nowUTC()))
	return err
}

// baselineTranscript registers an explicitly enrolled session at EOF, with a
// bounded hash anchor for allowed sessions and no historical event parsing.
// Enrollment cannot backfill earlier activity. A path not created yet is
// registered at offset zero and remains uninitialized; all records written
// after that hook are therefore eligible when the file appears.
func (s *Store) baselineTranscript(ctx context.Context, path, sessionID, agent string) error {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "." || path == "" {
		return nil
	}
	enabled, err := s.telemetryEnabled(ctx)
	if err != nil {
		return err
	}
	allowed, known, err := s.sessionAllowed(ctx, sessionID)
	if err != nil {
		return err
	}
	if err := s.reassignTranscriptCursor(ctx, path, sessionID, agent, enabled && known && allowed); err != nil {
		return err
	}
	if !enabled || !known || !allowed {
		return nil
	}
	return nil
}

func (s *Store) ReconcileTranscripts(ctx context.Context, paths []transcriptPath) (SyncResult, error) {
	var result SyncResult
	for _, item := range paths {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		if err := s.reconcileTranscript(ctx, item, &result); err != nil {
			return result, err
		}
	}
	return result, nil
}

func (s *Store) reconcileTranscript(ctx context.Context, item transcriptPath, result *SyncResult) error {
	stat, err := os.Stat(item.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	pathSessionID := sessionIDFromPath(item.path)
	var cursorID, cursorSessionID, cursorAgent string
	var offset int64
	var initialized int
	err = s.db.QueryRowContext(ctx, `SELECT file_id, offset, initialized, session_id, agent FROM cursors WHERE path=?`, item.path).Scan(&cursorID, &offset, &initialized, &cursorSessionID, &cursorAgent)
	if errors.Is(err, sql.ErrNoRows) {
		// A new cursor will be inserted only after the session policy is known.
		err = sql.ErrNoRows
	} else if err != nil {
		return err
	}
	sessionID := pathSessionID
	if cursorSessionID != "" {
		// SessionStart can provide the only trustworthy association when a
		// transcript's filename/first line lacks a session/thread field.
		sessionID = cursorSessionID
	}
	if telemetryDisabledForProcess() {
		if err := s.rememberSession(ctx, sessionID, false, "environment"); err != nil {
			return err
		}
		if err := s.purgeSession(ctx, sessionID); err != nil {
			return err
		}
		return nil
	}
	if enabled, err := s.telemetryEnabled(ctx); err != nil {
		return err
	} else if !enabled {
		return nil
	}
	if allowed, known, err := s.sessionAllowed(ctx, sessionID); err != nil {
		return err
	} else if !known {
		s.addDiagnostic("session_policy_unknown", "skipped an unregistered transcript session")
		result.Diagnostics++
		return nil
	} else if !allowed {
		return nil
	}
	if cursorSessionID == "" {
		// Do not inspect transcript content for an unknown session. The path
		// policy above is established by an explicit hook or a matching path;
		// only then may the first structured line refine the association.
		if discovered := discoverTranscriptSession(item.path, sessionID); discovered != "" && discovered != sessionID {
			if discoveredAllowed, discoveredKnown, discoverErr := s.sessionAllowed(ctx, discovered); discoverErr != nil {
				return discoverErr
			} else if !discoveredKnown || !discoveredAllowed {
				s.addDiagnostic("session_policy_unknown", "skipped a transcript session without an established telemetry policy")
				result.Diagnostics++
				return nil
			} else {
				sessionID = discovered
			}
		}
	}
	if errors.Is(err, sql.ErrNoRows) {
		fileID, anchorErr := transcriptAnchor(item.path, stat.Size())
		if anchorErr != nil {
			return anchorErr
		}
		if _, err := s.db.ExecContext(ctx, `INSERT INTO cursors(path, file_id, offset, initialized, session_id, agent, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)`, item.path, fileID, stat.Size(), sessionID, item.agent, formatTime(nowUTC())); err != nil {
			return err
		}
		// New enrollment never backfills an existing transcript.
		return nil
	}
	if err != nil {
		return err
	}
	if initialized == 0 {
		// An empty file_id is the durable marker written when a hook observed a
		// transcript path before the host created the file. Start that first
		// file at zero so records written after enrollment are not lost. Legacy
		// initialized=0 cursors with a file identity retain the old EOF-safe
		// behavior.
		startAtZero := cursorID == ""
		startOffset := stat.Size()
		if startAtZero {
			startOffset = 0
		}
		fileID, anchorErr := transcriptAnchor(item.path, startOffset)
		if anchorErr != nil {
			return anchorErr
		}
		if _, err := s.db.ExecContext(ctx, `UPDATE cursors SET file_id=?, offset=?, initialized=1, session_id=?, agent=?, updated_at=? WHERE path=?`, fileID, startOffset, sessionID, nonEmpty(cursorAgent, item.agent), formatTime(nowUTC()), item.path); err != nil {
			return err
		}
		if !startAtZero {
			return nil
		}
		offset = startOffset
	}
	sizeMovedBack := stat.Size() < offset
	if sizeMovedBack {
		s.addDiagnostic("transcript_rotated", "transcript size moved backwards; resumed from the beginning of the new file")
		result.Diagnostics++
		offset = 0
	}
	if !sizeMovedBack && strings.HasPrefix(cursorID, "anchor:") {
		currentFileID, anchorErr := transcriptAnchor(item.path, offset)
		if anchorErr != nil {
			return anchorErr
		}
		if currentFileID != cursorID {
			s.addDiagnostic("transcript_rotated", "transcript anchor changed; resumed from the beginning of the replacement file")
			result.Diagnostics++
			offset = 0
		}
	}
	if stat.Size() == offset {
		fileID, anchorErr := transcriptAnchor(item.path, offset)
		if anchorErr != nil {
			return anchorErr
		}
		if fileID != cursorID {
			if _, updateErr := s.db.ExecContext(ctx, `UPDATE cursors SET file_id=?, offset=?, initialized=1, updated_at=? WHERE path=?`, fileID, offset, formatTime(nowUTC()), item.path); updateErr != nil {
				return updateErr
			}
		}
		return nil
	}
	file, err := os.Open(item.path)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return err
	}
	data, err := io.ReadAll(io.LimitReader(file, 16*1024*1024))
	if err != nil {
		return err
	}
	lastNewline := len(data)
	if index := strings.LastIndexByte(string(data), '\n'); index >= 0 {
		lastNewline = index + 1
	} else {
		lastNewline = 0
	}
	complete := data[:lastNewline]
	if len(complete) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	lineOffset := offset
	for len(complete) > 0 {
		lineEnd := strings.IndexByte(string(complete), '\n')
		if lineEnd < 0 {
			break
		}
		line := complete[:lineEnd]
		lineSize := lineEnd + 1
		lineOffset += int64(lineSize)
		complete = complete[lineSize:]
		result.Scanned++
		if err := s.reconcileTranscriptLine(ctx, tx, item, sessionID, line, result); err != nil {
			return err
		}
	}
	fileID, err := transcriptAnchor(item.path, lineOffset)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE cursors SET file_id=?, offset=?, initialized=1, session_id=?, agent=?, updated_at=? WHERE path=?`, fileID, lineOffset, sessionID, nonEmpty(cursorAgent, item.agent), formatTime(nowUTC()), item.path); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return nil
}

func (s *Store) reconcileTranscriptLine(ctx context.Context, tx *sql.Tx, item transcriptPath, defaultSession string, line []byte, result *SyncResult) error {
	var object map[string]any
	if err := json.Unmarshal(line, &object); err != nil {
		insertDiagnostic(ctx, tx, "transcript_unknown_format", "skipped a transcript line with invalid JSON")
		result.Diagnostics++
		return nil
	}
	return s.reconcileTranscriptObject(ctx, tx, item, defaultSession, object, result)
}

func (s *Store) reconcileTranscriptObject(ctx context.Context, tx *sql.Tx, item transcriptPath, defaultSession string, object map[string]any, result *SyncResult) error {
	// Claude stores tool calls inside message.content arrays. Walk only
	// structured objects; prompt text is never inspected for skill names.
	if message, ok := object["message"].(map[string]any); ok {
		if content, ok := message["content"].([]any); ok {
			for _, part := range content {
				if nested, ok := part.(map[string]any); ok {
					if err := s.reconcileTranscriptObject(ctx, tx, item, defaultSession, nested, result); err != nil {
						return err
					}
				}
			}
		}
	}
	// Codex Desktop emits structured command completion records.  Only a
	// successful parsed_cmd read whose name is exactly SKILL.md is evidence of
	// a skill read; stdout, shell command text, and prompts are never parsed.
	if item.agent == "codex" {
		if signals := codexCompletedReads(object, defaultSession); len(signals) > 0 {
			for _, signal := range signals {
				capture, captureErr := s.captureEventTx(ctx, tx, CaptureInput{
					SkillRef:      signal.SkillRef,
					Kind:          "read",
					Adapter:       "codex-transcript",
					Agent:         "codex",
					Environment:   currentEnvironment(),
					SessionID:     signal.SessionID,
					TurnID:        signal.TurnID,
					CallID:        signal.CallID,
					Source:        "transcript",
					RequirePolicy: true,
				})
				if captureErr != nil && !errors.Is(captureErr, errQueueFull) {
					return captureErr
				}
				if capture.Captured {
					result.Queued++
				}
			}
		}
	}
	lineType := strings.ToLower(stringField(object, "type", "event", "event_type"))
	name := strings.ToLower(stringField(object, "name", "tool_name", "function", "operation"))
	callID := stringField(object, "id", "call_id", "callId", "tool_use_id", "toolUseId", "invocation_id")
	sessionID := nonEmpty(stringField(object, "session_id", "sessionId", "conversation_id"), defaultSession)
	turnID := stringField(object, "turn_id", "turnId", "response_id")
	if callID != "" && (lineType == "tool_use" || lineType == "tool_call" || lineType == "function_call" || name == "skill" || name == "skill_invocation") {
		ref := findStructuredSkillRef(object)
		if ref != "" {
			if _, err := tx.ExecContext(ctx, `INSERT INTO transcript_calls(call_key, call_id, path, session_id, skill_ref, turn_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(call_key) DO UPDATE SET call_id=excluded.call_id, path=excluded.path, session_id=excluded.session_id, skill_ref=excluded.skill_ref, turn_id=excluded.turn_id, updated_at=excluded.updated_at`, transcriptCallKey(sessionID, callID), callID, item.path, sessionID, ref, turnID, formatTime(nowUTC())); err != nil {
				return err
			}
		}
	}
	if lineType == "tool_result" || lineType == "tool_return" || lineType == "function_result" || strings.Contains(lineType, "result") {
		if callID == "" {
			callID = stringField(object, "tool_use_id", "toolUseId", "call_id", "callId")
		}
		if callID == "" {
			return nil
		}
		var call transcriptCall
		callKey := transcriptCallKey(sessionID, callID)
		err := tx.QueryRowContext(ctx, `SELECT call_id, skill_ref, session_id, turn_id FROM transcript_calls WHERE call_key=?`, callKey).Scan(&call.CallID, &call.SkillRef, &call.SessionID, &call.TurnID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if failed, known := failureField(object); known && failed {
			_, _ = tx.ExecContext(ctx, `DELETE FROM transcript_calls WHERE call_key=?`, callKey)
			return nil
		}
		capture, captureErr := s.captureEventTx(ctx, tx, CaptureInput{
			SkillRef:      call.SkillRef,
			Kind:          "invocation",
			Adapter:       adapterForTranscript(item.agent),
			Agent:         item.agent,
			Environment:   currentEnvironment(),
			SessionID:     call.SessionID,
			TurnID:        call.TurnID,
			CallID:        call.CallID,
			Source:        "transcript",
			RequirePolicy: true,
		})
		if captureErr != nil && !errors.Is(captureErr, errQueueFull) {
			return captureErr
		}
		if capture.Captured {
			result.Queued++
		}
		_, _ = tx.ExecContext(ctx, `DELETE FROM transcript_calls WHERE call_key=?`, callKey)
		return nil
	}
	// A transcript may carry a typed read/request signal from a native audit
	// record. Without an explicit kind, no prompt or free text is interpreted.
	if kind := strings.ToLower(stringField(object, "kind", "event_kind", "signal_kind")); validKinds[kind] {
		ref := findStructuredSkillRef(object)
		if ref == "" {
			return nil
		}
		capture, captureErr := s.captureEventTx(ctx, tx, CaptureInput{
			SkillRef:      ref,
			Kind:          kind,
			Adapter:       adapterForTranscript(item.agent),
			Agent:         item.agent,
			Environment:   currentEnvironment(),
			SessionID:     sessionID,
			TurnID:        turnID,
			CallID:        callID,
			Source:        "transcript",
			RequirePolicy: true,
		})
		if captureErr != nil && !errors.Is(captureErr, errQueueFull) {
			return captureErr
		}
		if capture.Captured {
			result.Queued++
		}
	}
	return nil
}

func codexPathIsAbsolute(path string) bool {
	if filepath.IsAbs(path) || strings.HasPrefix(path, "/") || strings.HasPrefix(path, `\\`) {
		return true
	}
	return len(path) >= 3 && ((path[0] >= 'a' && path[0] <= 'z') || (path[0] >= 'A' && path[0] <= 'Z')) && path[1] == ':' && (path[2] == '/' || path[2] == '\\')
}

func decodeCodexPath(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	if !strings.HasPrefix(strings.ToLower(raw), "file://") {
		return filepath.Clean(raw), codexPathIsAbsolute(raw)
	}
	parsed, err := url.Parse(raw)
	if err != nil || !strings.EqualFold(parsed.Scheme, "file") {
		return "", false
	}
	host := parsed.Host
	if host != "" && !strings.EqualFold(host, "localhost") {
		// A drive letter can appear as the authority in file://C:/...;
		// arbitrary network shares are deliberately not accepted.
		if len(host) != 2 || host[1] != ':' {
			return "", false
		}
	}
	escaped := parsed.EscapedPath()
	pathValue, err := url.PathUnescape(escaped)
	if err != nil {
		return "", false
	}
	if len(host) == 2 && host[1] == ':' {
		pathValue = host + "/" + strings.TrimPrefix(pathValue, "/")
	}
	if len(pathValue) >= 3 && pathValue[0] == '/' && ((pathValue[1] >= 'a' && pathValue[1] <= 'z') || (pathValue[1] >= 'A' && pathValue[1] <= 'Z')) && pathValue[2] == ':' {
		pathValue = pathValue[1:]
	}
	pathValue = filepath.Clean(filepath.FromSlash(pathValue))
	return pathValue, codexPathIsAbsolute(pathValue)
}

func resolveCodexReadPath(command, item, payload map[string]any) string {
	rawPath := stringField(command, "path")
	pathValue, absolute := decodeCodexPath(rawPath)
	if pathValue == "" {
		return ""
	}
	if absolute {
		return filepath.Clean(pathValue)
	}
	rawCWD := stringField(item, "cwd", "working_directory", "workdir")
	if rawCWD == "" {
		rawCWD = stringField(payload, "cwd", "working_directory", "workdir")
	}
	cwd, cwdAbsolute := decodeCodexPath(rawCWD)
	if !cwdAbsolute {
		return ""
	}
	return filepath.Clean(filepath.Join(cwd, pathValue))
}

func codexCompletedReads(object map[string]any, defaultSession string) []hookSignal {
	if stringField(object, "type") != "event_msg" {
		return nil
	}
	payload, ok := object["payload"].(map[string]any)
	if !ok || stringField(payload, "type") != "item_completed" {
		return nil
	}
	item, ok := payload["item"].(map[string]any)
	if !ok || stringField(item, "type") != "CommandExecution" || stringField(item, "status") != "completed" {
		return nil
	}
	exitCode, ok := item["exit_code"].(float64)
	if !ok || exitCode != 0 {
		return nil
	}
	commands, ok := item["parsed_cmd"].([]any)
	if !ok {
		return nil
	}
	sessionID := nonEmpty(transcriptSessionField(payload), defaultSession)
	turnID := stringField(payload, "turn_id", "turnId")
	callID := stringField(item, "id")
	var result []hookSignal
	for _, raw := range commands {
		command, ok := raw.(map[string]any)
		if !ok || stringField(command, "type") != "read" || stringField(command, "name") != "SKILL.md" {
			continue
		}
		path := resolveCodexReadPath(command, item, payload)
		if path == "" {
			continue
		}
		result = append(result, hookSignal{Kind: "read", SkillRef: path, SessionID: sessionID, TurnID: turnID, CallID: callID, Source: "transcript"})
	}
	return result
}

func adapterForTranscript(agent string) string {
	if agent == "claude-code" {
		return "claude-transcript"
	}
	return "codex-transcript"
}

func (s *Store) ReconcileDefaultTranscripts(ctx context.Context) (SyncResult, error) {
	// Hooks explicitly register transcript paths by creating a cursor with the
	// session and agent association. Never walk host transcript directories:
	// an unregistered path must not be opened or used to infer consent.
	rows, err := s.db.QueryContext(ctx, `SELECT path, agent FROM cursors WHERE session_id <> '' AND agent IN ('codex', 'claude-code') ORDER BY updated_at DESC, path LIMIT ?`, MaxQueueEvents)
	if err != nil {
		return SyncResult{}, err
	}
	defer rows.Close()
	paths := make([]transcriptPath, 0)
	for rows.Next() {
		var path, agent string
		if err := rows.Scan(&path, &agent); err != nil {
			return SyncResult{}, err
		}
		paths = append(paths, transcriptPath{path: path, agent: agent})
	}
	if err := rows.Err(); err != nil {
		return SyncResult{}, err
	}
	return s.ReconcileTranscripts(ctx, paths)
}
