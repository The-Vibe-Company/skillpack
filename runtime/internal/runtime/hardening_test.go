package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testStoreWithSkill(t *testing.T) (*Store, string) {
	t.Helper()
	stateDir := t.TempDir()
	skillDir := filepath.Join(t.TempDir(), "skill")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	const origin = "https://skillpack.app"
	if _, err := store.RegisterInventory(Inventory{
		SchemaVersion: SchemaVersion,
		Origins:       []string{origin},
		Skills:        []InventorySkill{{Path: skillDir, SkillID: "11111111-1111-4111-8111-111111111111", Version: "1.0.0", Origin: origin}},
	}); err != nil {
		store.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, skillDir
}

func testCaptureInput(skillDir, kind string) CaptureInput {
	return CaptureInput{SkillRef: skillDir, Kind: kind, Adapter: "codex-hook", Agent: "codex", Environment: "local"}
}

func TestConfiguredIdentityIsRestrictedToWireIdentityFields(t *testing.T) {
	store, skillDir := testStoreWithSkill(t)
	t.Setenv("SKILLPACK_TELEMETRY_USER_ID", "configured-user")
	t.Setenv("SKILLPACK_TELEMETRY_EMAIL", "configured@example.test")
	captured, err := store.CaptureEvent(context.Background(), testCaptureInput(skillDir, "read"))
	if err != nil || !captured.Captured {
		t.Fatalf("capture=%#v err=%v", captured, err)
	}
	var payload []byte
	if err := store.db.QueryRow(`SELECT payload FROM events WHERE event_id=?`, captured.EventID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	var event Event
	if err := json.Unmarshal(payload, &event); err != nil {
		t.Fatal(err)
	}
	if event.Identity == nil || event.Identity.UserID != "configured-user" || event.Identity.Email != "configured@example.test" || event.Identity.Source != "configured" {
		t.Fatalf("wire identity=%#v", event.Identity)
	}
	if strings.Contains(string(payload), "SKILLPACK_TELEMETRY") || strings.Contains(string(payload), "stateDir") {
		t.Fatalf("wire payload leaked local configuration: %s", payload)
	}
}

func TestGlobalDisablePurgesAllLocalEvents(t *testing.T) {
	store, skillDir := testStoreWithSkill(t)
	if _, err := store.CaptureEvent(context.Background(), testCaptureInput(skillDir, "read")); err != nil {
		t.Fatal(err)
	}
	if err := store.setTelemetry(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	stats, err := store.QueueStats(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if stats.Pending != 0 || stats.Sent != 0 || stats.Dead != 0 {
		t.Fatalf("queue after global disable=%#v", stats)
	}
	if err := store.setTelemetry(context.Background(), true); err != nil {
		t.Fatal(err)
	}
}

func TestQueueLimitDropsWithoutExceedingTenThousandEvents(t *testing.T) {
	store, skillDir := testStoreWithSkill(t)
	tx, err := store.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < MaxQueueEvents; i++ {
		eventID := fmt.Sprintf("queue-%05d", i)
		if _, err := tx.Exec(`INSERT INTO events(event_id, skill_id, version, kind, adapter, observed_at, agent, environment, endpoint, payload, payload_bytes, source, created_at, attempts, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending')`, eventID, "11111111-1111-4111-8111-111111111111", "1.0.0", "read", "codex-hook", "2026-09-23T00:00:00Z", "codex", "local", "https://skillpack.app/v1/skill-usage-events", []byte(`{}`), 2, "test", "2026-09-23T00:00:00Z"); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	result, err := store.CaptureEvent(context.Background(), testCaptureInput(skillDir, "invocation"))
	if !errors.Is(err, errQueueFull) || result.Captured || result.Reason != "queue_full" {
		t.Fatalf("full queue capture=%#v err=%v", result, err)
	}
	stats, err := store.QueueStats(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if stats.Pending != MaxQueueEvents || stats.Bytes > MaxQueueBytes {
		t.Fatalf("bounded queue stats=%#v", stats)
	}
}

func TestTransportLossKeepsEventForRetryWithSameID(t *testing.T) {
	store, skillDir := testStoreWithSkill(t)
	captured, err := store.CaptureEvent(context.Background(), testCaptureInput(skillDir, "request"))
	if err != nil || !captured.Captured {
		t.Fatalf("capture=%#v err=%v", captured, err)
	}
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("network down")
	})}
	report, err := store.SendPending(context.Background(), client)
	if err != nil {
		t.Fatal(err)
	}
	if report.retried != 1 || report.sent != 0 || report.terminal != 0 {
		t.Fatalf("loss report=%#v", report)
	}
	var status string
	var attempts int
	if err := store.db.QueryRow(`SELECT status, attempts FROM events WHERE event_id=?`, captured.EventID).Scan(&status, &attempts); err != nil {
		t.Fatal(err)
	}
	if status != "pending" || attempts != 1 {
		t.Fatalf("event after loss status=%q attempts=%d", status, attempts)
	}
	rows, err := store.pendingEvents(context.Background(), nowUTC().Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].EventID != captured.EventID {
		t.Fatalf("pending event after loss=%#v", rows)
	}
}

func TestReadEvidenceDedupesAcrossAdaptersByTurnButInvocationsKeepCallIDs(t *testing.T) {
	store, skillDir := testStoreWithSkill(t)
	first, err := store.CaptureEvent(context.Background(), CaptureInput{SkillRef: skillDir, Kind: "read", Adapter: "codex-hook", Agent: "codex", Environment: "local", SessionID: "same-session", TurnID: "same-turn", CallID: "hook-call"})
	if err != nil || !first.Captured {
		t.Fatalf("first read=%#v err=%v", first, err)
	}
	second, err := store.CaptureEvent(context.Background(), CaptureInput{SkillRef: skillDir, Kind: "read", Adapter: "codex-transcript", Agent: "codex", Environment: "local", SessionID: "same-session", TurnID: "same-turn", CallID: "transcript-item"})
	if err != nil || second.Captured || second.Reason != "duplicate" || second.EventID != first.EventID {
		t.Fatalf("transcript read=%#v err=%v", second, err)
	}
	for _, callID := range []string{"native-a", "native-b"} {
		capture, captureErr := store.CaptureEvent(context.Background(), CaptureInput{SkillRef: skillDir, Kind: "invocation", Adapter: "codex-transcript", Agent: "codex", Environment: "local", SessionID: "same-session", TurnID: "same-turn", CallID: callID})
		if captureErr != nil || !capture.Captured {
			t.Fatalf("invocation %s=%#v err=%v", callID, capture, captureErr)
		}
	}
	stats, err := store.QueueStats(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if stats.Pending != 3 {
		t.Fatalf("pending=%d, want read plus two invocations", stats.Pending)
	}
}

func TestClaudeHookAndTranscriptInvocationWithSameCallIDDedupeAcrossTurnFields(t *testing.T) {
	t.Setenv("SKILLPACK_RUNTIME_NO_WAKE", "1")
	stateDir := t.TempDir()
	skillDir := filepath.Join(t.TempDir(), "runtime-proof")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	transcript := filepath.Join(t.TempDir(), "claude-session.jsonl")
	if err := os.WriteFile(transcript, []byte(`{"type":"session_meta","session_id":"claude-dedupe-session"}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err := store.RegisterInventory(Inventory{SchemaVersion: 1, Origins: []string{"https://skillpack.app"}, Skills: []InventorySkill{{Path: skillDir, SkillID: "11111111-1111-4111-8111-111111111111", Version: "1.0.0", Origin: "https://skillpack.app"}}}); err != nil {
		t.Fatal(err)
	}
	start, _ := json.Marshal(map[string]any{"hook_event_name": "SessionStart", "session_id": "claude-dedupe-session", "transcript_path": transcript})
	if results, err := store.HandleHook(context.Background(), "claude-code", bytes.NewReader(start)); err != nil || len(results) != 1 || results[0].Reason != "session_enrolled" {
		t.Fatalf("session start=%#v err=%v", results, err)
	}
	hookEvent := func(callID, promptID string) []byte {
		value, _ := json.Marshal(map[string]any{
			"hook_event_name": "PostToolUse", "session_id": "claude-dedupe-session", "prompt_id": promptID,
			"tool_name": "Skill", "tool_use_id": callID,
			"tool_input":    map[string]any{"skill": skillDir},
			"tool_response": map[string]any{"success": true, "commandName": "runtime-proof"},
		})
		return value
	}
	if results, err := store.HandleHook(context.Background(), "claude-code", bytes.NewReader(hookEvent("same-call", "prompt-1"))); err != nil || len(results) != 1 || !results[0].Captured {
		t.Fatalf("first hook=%#v err=%v", results, err)
	}
	var events int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM events WHERE status='pending'`).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events != 1 {
		t.Fatalf("events after first hook=%d, want 1", events)
	}
	transcriptLines := []string{
		`{"type":"assistant","message":{"content":[{"type":"tool_use","id":"same-call","name":"Skill","input":{"skill":"` + skillDir + `"}}]}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"same-call","is_error":false}]}}`,
	}
	file, err := os.OpenFile(transcript, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range transcriptLines {
		if _, err := file.WriteString(line + "\n"); err != nil {
			_ = file.Close()
			t.Fatal(err)
		}
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if result, err := store.ReconcileTranscripts(context.Background(), []transcriptPath{{path: transcript, agent: "claude-code"}}); err != nil {
		t.Fatal(err)
	} else if result.Queued != 0 {
		t.Fatalf("transcript duplicate queued=%d, want 0", result.Queued)
	}
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM events WHERE status='pending'`).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events != 1 {
		t.Fatalf("events after transcript=%d, want 1", events)
	}
	for index, callID := range []string{"different-call-a", "different-call-b"} {
		results, err := store.HandleHook(context.Background(), "claude-code", bytes.NewReader(hookEvent(callID, fmt.Sprintf("prompt-%d", index+2))))
		if err != nil || len(results) != 1 || !results[0].Captured {
			t.Fatalf("distinct hook %s=%#v err=%v", callID, results, err)
		}
	}
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM events WHERE status='pending'`).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events != 3 {
		t.Fatalf("events after distinct calls=%d, want 3", events)
	}
}
