package runtime

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type CaptureInput struct {
	SkillRef      string
	Kind          string
	Adapter       string
	Agent         string
	Environment   string
	SessionID     string
	TurnID        string
	CallID        string
	InstanceID    string
	Source        string
	ObservedAt    time.Time
	Identity      *Identity
	RequirePolicy bool
}

func newUUID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	var encoded [36]byte
	hex.Encode(encoded[0:8], bytes[0:4])
	encoded[8] = '-'
	hex.Encode(encoded[9:13], bytes[4:6])
	encoded[13] = '-'
	hex.Encode(encoded[14:18], bytes[6:8])
	encoded[18] = '-'
	hex.Encode(encoded[19:23], bytes[8:10])
	encoded[23] = '-'
	hex.Encode(encoded[24:36], bytes[10:16])
	return string(encoded[:]), nil
}

func normalizedObservedAt(value time.Time) string {
	if value.IsZero() {
		value = nowUTC()
	}
	return formatTime(value)
}

func eventLocalKey(input CaptureInput, skill Skill) string {
	if strings.TrimSpace(input.SessionID) == "" || (strings.TrimSpace(input.CallID) == "" && strings.TrimSpace(input.TurnID) == "") {
		return ""
	}
	callID := input.CallID
	turnID := input.TurnID
	// Read evidence from a hook and the agent transcript often carries
	// different command IDs for the same turn. Group those by turn and skill;
	// invocation events retain their call ID so distinct native invocations are
	// not collapsed. Native invocation IDs are stable across the hook and
	// transcript records, while one side may not carry a turn/prompt ID.
	if input.Kind == "read" && strings.TrimSpace(turnID) != "" {
		callID = ""
	}
	if input.Kind == "invocation" && strings.TrimSpace(callID) != "" {
		turnID = ""
	}
	return strings.Join([]string{
		input.InstanceID,
		input.SessionID,
		input.Agent,
		turnID,
		callID,
		skill.SkillID,
		skill.Version,
		input.Kind,
	}, "\x1f")
}

func eventEndpoint(origin string) string { return strings.TrimRight(origin, "/") + EventPath }

func (s *Store) CaptureEvent(ctx context.Context, input CaptureInput) (CaptureResult, error) {
	if err := s.pruneBoundedState(ctx); err != nil {
		return CaptureResult{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return CaptureResult{}, err
	}
	result, err := s.captureEventTx(ctx, tx, input)
	if err != nil {
		if errors.Is(err, errQueueFull) {
			// Keep the bounded-drop diagnostic even though no event was
			// accepted into the transaction.
			if commitErr := tx.Commit(); commitErr != nil {
				return result, commitErr
			}
			return result, err
		}
		_ = tx.Rollback()
		return result, err
	}
	if err := tx.Commit(); err != nil {
		return CaptureResult{}, err
	}
	return result, nil
}

func (s *Store) captureEventTx(ctx context.Context, tx *sql.Tx, input CaptureInput) (CaptureResult, error) {
	if !validKinds[input.Kind] {
		return CaptureResult{Reason: "invalid_kind"}, fmt.Errorf("invalid event kind %q", input.Kind)
	}
	if !validAdapters[input.Adapter] {
		return CaptureResult{Reason: "invalid_adapter"}, fmt.Errorf("invalid event adapter %q", input.Adapter)
	}
	if !validAgents[input.Agent] {
		return CaptureResult{Reason: "invalid_agent"}, fmt.Errorf("invalid event agent %q", input.Agent)
	}
	if !validEnvironments[input.Environment] {
		return CaptureResult{Reason: "invalid_environment"}, fmt.Errorf("invalid event environment %q", input.Environment)
	}
	enabled, err := telemetryEnabledWith(ctx, tx)
	if err != nil {
		return CaptureResult{}, err
	}
	if telemetryDisabledForProcess() {
		if input.SessionID != "" {
			_ = rememberSessionWith(ctx, tx, input.SessionID, false, "environment")
			_ = purgeSessionWith(ctx, tx, input.SessionID)
		}
		return CaptureResult{Reason: "environment_opt_out"}, nil
	}
	if !enabled {
		return CaptureResult{Reason: "telemetry_disabled"}, nil
	}
	if input.SessionID != "" {
		allowed, known, err := sessionAllowedWith(ctx, tx, input.SessionID)
		if err != nil {
			return CaptureResult{}, err
		}
		if !known {
			if input.RequirePolicy {
				insertDiagnostic(ctx, tx, "session_policy_unknown", "skipped a transcript session without an established telemetry policy")
				return CaptureResult{Reason: "session_policy_unknown"}, nil
			}
			if err := rememberSessionWith(ctx, tx, input.SessionID, true, input.Source); err != nil {
				return CaptureResult{}, err
			}
		} else if !allowed {
			return CaptureResult{Reason: "session_opt_out"}, nil
		}
	}
	skill, ok, err := resolveSkillWith(ctx, tx, input.SkillRef)
	if err != nil {
		return CaptureResult{}, err
	}
	if !ok {
		insertDiagnostic(ctx, tx, "unknown_skill", "skipped a signal that did not resolve to one inventoried skill")
		return CaptureResult{Reason: "unknown_skill"}, nil
	}
	eventID, err := newUUID()
	if err != nil {
		return CaptureResult{}, err
	}
	identity := input.Identity
	if identity == nil {
		identity = configuredIdentity()
	}
	if identity != nil {
		validSource := identity.Source == "configured" || identity.Source == "skillpack-local" || identity.Source == "git-local" || identity.Source == "git-global"
		if !validSource || (strings.TrimSpace(identity.UserID) == "" && strings.TrimSpace(identity.Email) == "") {
			identity = nil
		}
	}
	event := Event{
		SchemaVersion: SchemaVersion,
		EventID:       eventID,
		SkillID:       skill.SkillID,
		Version:       skill.Version,
		Kind:          input.Kind,
		Adapter:       input.Adapter,
		ObservedAt:    normalizedObservedAt(input.ObservedAt),
		Agent:         input.Agent,
		Environment:   input.Environment,
		Identity:      identity,
	}
	payload, err := json.Marshal(event)
	if err != nil {
		return CaptureResult{}, err
	}
	if len(payload) > MaxEventBytes {
		insertDiagnostic(ctx, tx, "payload_too_large", "event payload exceeded the 4 KiB wire limit")
		return CaptureResult{Reason: "payload_too_large"}, nil
	}
	identityJSON, err := marshalIdentity(identity)
	if err != nil {
		return CaptureResult{}, err
	}
	localKey := eventLocalKey(input, skill)
	now := nowUTC()
	if localKey != "" {
		var existing string
		err := tx.QueryRowContext(ctx, `SELECT event_id FROM events WHERE local_key=?`, localKey).Scan(&existing)
		if err == nil {
			return CaptureResult{Captured: false, EventID: existing, Kind: input.Kind, Reason: "duplicate"}, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return CaptureResult{}, err
		}
	}
	var count int
	var bytes int64
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(payload_bytes), 0) FROM events WHERE status NOT IN ('sent','dead')`).Scan(&count, &bytes); err != nil {
		return CaptureResult{}, err
	}
	if count >= MaxQueueEvents || bytes+int64(len(payload)) > MaxQueueBytes {
		insertDiagnostic(ctx, tx, "queue_full", "local telemetry queue reached its bounded capacity")
		return CaptureResult{Reason: "queue_full"}, errQueueFull
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO events(event_id, skill_id, version, kind, adapter, observed_at, agent, environment, identity_json, endpoint, payload, payload_bytes, local_key, session_id, source, created_at, attempts, next_attempt, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending')`, event.EventID, event.SkillID, event.Version, event.Kind, event.Adapter, event.ObservedAt, event.Agent, event.Environment, identityJSON, eventEndpoint(skill.Origin), payload, len(payload), nullIfEmpty(localKey), nullIfEmpty(input.SessionID), nonEmpty(input.Source, "hook"), formatTime(now), formatTime(now))
	if err != nil {
		return CaptureResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO settings(key, value) VALUES ('last_capture', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, formatTime(now)); err != nil {
		return CaptureResult{}, err
	}
	return CaptureResult{Captured: true, EventID: event.EventID, Kind: event.Kind}, nil
}

func nonEmpty(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (s *Store) pendingEvents(ctx context.Context, now time.Time) ([]localEvent, error) {
	return s.pendingEventsBatch(ctx, now, 0)
}

func (s *Store) pendingEventsBatch(ctx context.Context, now time.Time, limit int) ([]localEvent, error) {
	query := `SELECT event_id, skill_id, version, kind, adapter, observed_at, agent, environment, identity_json, endpoint, payload, local_key, session_id, source, created_at, attempts, COALESCE(next_attempt, ''), status FROM events WHERE status='pending' AND (next_attempt IS NULL OR next_attempt <= ?) ORDER BY created_at, event_id`
	args := []any{formatTime(now)}
	if limit > 0 {
		query += ` LIMIT ?`
		args = append(args, limit)
	}
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []localEvent
	for rows.Next() {
		var event localEvent
		var identityJSON, createdAt, nextAttempt sql.NullString
		var localKey, sessionID sql.NullString
		if err := rows.Scan(&event.EventID, &event.SkillID, &event.Version, &event.Kind, &event.Adapter, &event.ObservedAt, &event.Agent, &event.Environment, &identityJSON, &event.Endpoint, &event.Payload, &localKey, &sessionID, &event.Source, &createdAt, &event.Attempts, &nextAttempt, &event.Status); err != nil {
			return nil, err
		}
		if identityJSON.Valid && identityJSON.String != "" {
			if err := json.Unmarshal([]byte(identityJSON.String), &event.Identity); err != nil {
				return nil, err
			}
		}
		if localKey.Valid {
			event.LocalKey = localKey.String
		}
		if sessionID.Valid {
			event.SessionID = sessionID.String
		}
		if createdAt.Valid {
			event.CreatedAt = parseStoredTime(createdAt.String)
		}
		if nextAttempt.Valid {
			event.NextAttempt = parseStoredTime(nextAttempt.String)
		}
		result = append(result, event)
	}
	return result, rows.Err()
}

func (s *Store) QueueStats(ctx context.Context) (QueueDoctor, error) {
	var result QueueDoctor
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(payload_bytes), 0) FROM events WHERE status='pending'`).Scan(&result.Pending, &result.Bytes)
	if err != nil {
		return result, err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM events WHERE status='sent'`).Scan(&result.Sent); err != nil {
		return result, err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM events WHERE status='dead'`).Scan(&result.Dead); err != nil {
		return result, err
	}
	return result, nil
}
