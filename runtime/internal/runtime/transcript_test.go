package runtime

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestTranscriptReconciliationIsIncrementalAndDoesNotBackfill(t *testing.T) {
	stateDir := t.TempDir()
	skillDir := filepath.Join(t.TempDir(), "official", "example")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	transcript := filepath.Join(t.TempDir(), "session-1.jsonl")
	initial := []byte(`{"type":"assistant","message":{"content":[{"type":"tool_use","id":"old-call","name":"Skill","input":{"skill":"` + skillDir + `"}}]}}` + "\n" + `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"old-call","is_error":false}]}}` + "\n")
	if err := os.WriteFile(transcript, initial, 0o600); err != nil {
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
	if err := store.rememberSession(context.Background(), "session-1", true, "hook"); err != nil {
		t.Fatal(err)
	}
	path := transcriptPath{path: transcript, agent: "claude-code"}
	first, err := store.ReconcileTranscripts(context.Background(), []transcriptPath{path})
	if err != nil {
		t.Fatal(err)
	}
	if first.Queued != 0 || first.Scanned != 0 {
		t.Fatalf("initial reconciliation = %#v, want no backfill", first)
	}

	call := map[string]any{"type": "assistant", "message": map[string]any{"content": []any{map[string]any{"type": "tool_use", "id": "new-call", "name": "Skill", "input": map[string]any{"skill": skillDir}}}}}
	result := map[string]any{"type": "user", "message": map[string]any{"content": []any{map[string]any{"type": "tool_result", "tool_use_id": "new-call", "is_error": false}}}}
	callData, _ := json.Marshal(call)
	resultData, _ := json.Marshal(result)
	file, err := os.OpenFile(transcript, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(append(callData, '\n')); err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(resultData); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	partial, err := store.ReconcileTranscripts(context.Background(), []transcriptPath{path})
	if err != nil {
		t.Fatal(err)
	}
	if partial.Queued != 0 {
		t.Fatalf("partial reconciliation queued = %d", partial.Queued)
	}
	file, err = os.OpenFile(transcript, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte("\n")); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	second, err := store.ReconcileTranscripts(context.Background(), []transcriptPath{path})
	if err != nil {
		t.Fatal(err)
	}
	if second.Queued != 1 || second.Scanned != 1 {
		t.Fatalf("incremental reconciliation = %#v", second)
	}
	stats, err := store.QueueStats(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if stats.Pending != 1 {
		t.Fatalf("pending events = %d, want 1", stats.Pending)
	}
}

func TestTranscriptCallIDsAreScopedToTheirSession(t *testing.T) {
	t.Setenv("SKILLPACK_RUNTIME_NO_WAKE", "1")
	stateDir := t.TempDir()
	skillDir := filepath.Join(t.TempDir(), "example")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	transcripts := []struct {
		path    string
		session string
	}{
		{path: filepath.Join(t.TempDir(), "session-a.jsonl"), session: "session-a"},
		{path: filepath.Join(t.TempDir(), "session-b.jsonl"), session: "session-b"},
	}
	for _, transcript := range transcripts {
		initial := fmt.Sprintf(`{"type":"session_meta","session_id":%q}`+"\n", transcript.session)
		if err := os.WriteFile(transcript.path, []byte(initial), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	store, err := OpenStore(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err := store.RegisterInventory(Inventory{SchemaVersion: 1, Origins: []string{"https://skillpack.app"}, Skills: []InventorySkill{{Path: skillDir, SkillID: "11111111-1111-4111-8111-111111111111", Version: "1.0.0", Origin: "https://skillpack.app"}}}); err != nil {
		t.Fatal(err)
	}
	paths := make([]transcriptPath, 0, len(transcripts))
	for _, transcript := range transcripts {
		if err := store.rememberSession(context.Background(), transcript.session, true, "hook"); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, transcriptPath{path: transcript.path, agent: "claude-code"})
	}
	if result, err := store.ReconcileTranscripts(context.Background(), paths); err != nil {
		t.Fatal(err)
	} else if result.Queued != 0 {
		t.Fatalf("initial reconciliation=%#v, want no backfill", result)
	}

	const reusedCallID = "reused-subagent-call"
	toolUse := func() string {
		return `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"` + reusedCallID + `","name":"Skill","input":{"skill":"` + skillDir + `"}}]}}` + "\n"
	}
	toolResult := func() string {
		return `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"` + reusedCallID + `","is_error":false}]}}` + "\n"
	}
	for _, transcript := range transcripts {
		file, openErr := os.OpenFile(transcript.path, os.O_APPEND|os.O_WRONLY, 0o600)
		if openErr != nil {
			t.Fatal(openErr)
		}
		if _, writeErr := file.WriteString(toolUse()); writeErr != nil {
			_ = file.Close()
			t.Fatal(writeErr)
		}
		if closeErr := file.Close(); closeErr != nil {
			t.Fatal(closeErr)
		}
	}
	if result, err := store.ReconcileTranscripts(context.Background(), paths); err != nil {
		t.Fatal(err)
	} else if result.Queued != 0 {
		t.Fatalf("tool-use reconciliation=%#v, want pending correlation only", result)
	}
	for _, transcript := range transcripts {
		file, openErr := os.OpenFile(transcript.path, os.O_APPEND|os.O_WRONLY, 0o600)
		if openErr != nil {
			t.Fatal(openErr)
		}
		if _, writeErr := file.WriteString(toolResult()); writeErr != nil {
			_ = file.Close()
			t.Fatal(writeErr)
		}
		if closeErr := file.Close(); closeErr != nil {
			t.Fatal(closeErr)
		}
	}
	result, err := store.ReconcileTranscripts(context.Background(), paths)
	if err != nil {
		t.Fatal(err)
	}
	if result.Queued != len(transcripts) {
		t.Fatalf("reused call ID reconciliation=%#v, want %d invocations", result, len(transcripts))
	}
	var pending int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM events WHERE status='pending'`).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != len(transcripts) {
		t.Fatalf("pending events=%d, want %d", pending, len(transcripts))
	}
	rows, err := store.db.Query(`SELECT session_id FROM events WHERE status='pending' ORDER BY session_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var sessions []string
	for rows.Next() {
		var session string
		if err := rows.Scan(&session); err != nil {
			t.Fatal(err)
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	wantSessions := []string{"session-a", "session-b"}
	if !reflect.DeepEqual(sessions, wantSessions) {
		t.Fatalf("pending sessions=%v, want %v", sessions, wantSessions)
	}
}

func TestTranscriptCallSchemaMigratesLegacyNullableCorrelationRows(t *testing.T) {
	stateDir := t.TempDir()
	dbPath := filepath.Join(stateDir, "runtime.sqlite3")
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(dbPath))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE transcript_calls (call_id TEXT PRIMARY KEY, path TEXT NOT NULL, session_id TEXT NOT NULL, skill_ref TEXT NOT NULL, turn_id TEXT, version TEXT, updated_at TEXT NOT NULL)`)
	if err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO transcript_calls(call_id, path, session_id, skill_ref, turn_id, version, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?)`, "legacy-call", "/tmp/legacy.jsonl", "legacy-session", "/tmp/skill", "2026-09-23T00:00:00.000Z")
	if err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var callKey, callID, sessionID, version, turnID string
	if err := store.db.QueryRow(`SELECT call_key, call_id, session_id, version, turn_id FROM transcript_calls`).Scan(&callKey, &callID, &sessionID, &version, &turnID); err != nil {
		t.Fatal(err)
	}
	if callKey != transcriptCallKey(sessionID, callID) || callID != "legacy-call" || sessionID != "legacy-session" || version != "" || turnID != "" {
		t.Fatalf("migrated correlation=(key=%q call=%q session=%q version=%q turn=%q)", callKey, callID, sessionID, version, turnID)
	}
}

func TestCodexTranscriptParsesSuccessfulStructuredSkillReadOnly(t *testing.T) {
	t.Setenv("SKILLPACK_RUNTIME_NO_WAKE", "1")
	stateDir := t.TempDir()
	skillDir := filepath.Join(t.TempDir(), "example")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	transcript := filepath.Join(t.TempDir(), "codex-session.jsonl")
	initial := []byte(`{"type":"event_msg","payload":{"type":"session_meta","thread_id":"thread-real"}}` + "\n")
	if err := os.WriteFile(transcript, initial, 0o600); err != nil {
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
	hook, _ := json.Marshal(map[string]any{"hook_event_name": "SessionStart", "session_id": "thread-real", "transcript_path": transcript})
	if results, err := store.HandleHook(context.Background(), "codex", bytes.NewReader(hook)); err != nil || len(results) != 1 || results[0].Reason != "session_enrolled" {
		t.Fatalf("session start=%#v err=%v", results, err)
	}
	completed := map[string]any{
		"type": "event_msg",
		"payload": map[string]any{
			"type": "item_completed", "thread_id": "thread-real", "turn_id": "turn-real",
			"item": map[string]any{
				"type": "CommandExecution", "id": "command-real", "status": "completed", "exit_code": 0,
				"parsed_cmd": []any{
					map[string]any{"type": "read", "name": "SKILL.md", "path": filepath.Join(skillDir, "SKILL.md")},
					map[string]any{"type": "exec", "cmd": "cat SKILL.md"},
				},
				"stdout": "SKILL.md text must never be inspected",
			},
		},
	}
	failed := map[string]any{
		"type": "event_msg",
		"payload": map[string]any{
			"type": "item_completed", "thread_id": "thread-real", "turn_id": "turn-failed",
			"item": map[string]any{"type": "CommandExecution", "id": "command-failed", "status": "completed", "exit_code": 1, "parsed_cmd": []any{map[string]any{"type": "read", "name": "SKILL.md", "path": filepath.Join(skillDir, "SKILL.md")}}},
		},
	}
	completedData, _ := json.Marshal(completed)
	failedData, _ := json.Marshal(failed)
	file, err := os.OpenFile(transcript, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(append(completedData, '\n')); err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(append(failedData, '\n')); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	result, err := store.ReconcileTranscripts(context.Background(), []transcriptPath{{path: transcript, agent: "codex"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Queued != 1 || result.Scanned != 2 {
		t.Fatalf("codex reconciliation=%#v", result)
	}
	var kind, adapter string
	if err := store.db.QueryRow(`SELECT kind, adapter FROM events LIMIT 1`).Scan(&kind, &adapter); err != nil {
		t.Fatal(err)
	}
	if kind != "read" || adapter != "codex-transcript" {
		t.Fatalf("event kind=%q adapter=%q", kind, adapter)
	}
}

func TestCodexTranscriptResolvesRelativeReadsAgainstStructuredCommandCWD(t *testing.T) {
	t.Setenv("SKILLPACK_RUNTIME_NO_WAKE", "1")
	stateDir := t.TempDir()
	workDir := filepath.Join(t.TempDir(), "codex project", "équipe")
	skillDir := filepath.Join(workDir, ".agents", "skills", "runtime-proof")
	decoyCWD := filepath.Join(t.TempDir(), "unrelated")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(decoyCWD, 0o755); err != nil {
		t.Fatal(err)
	}
	transcript := filepath.Join(t.TempDir(), "codex-relative.jsonl")
	if err := os.WriteFile(transcript, []byte(`{"type":"event_msg","payload":{"type":"session_meta","thread_id":"relative-session"}}`+"\n"), 0o600); err != nil {
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
	hook, _ := json.Marshal(map[string]any{"hook_event_name": "SessionStart", "session_id": "relative-session", "transcript_path": transcript})
	if results, err := store.HandleHook(context.Background(), "codex", bytes.NewReader(hook)); err != nil || len(results) != 1 || results[0].Reason != "session_enrolled" {
		t.Fatalf("session start=%#v err=%v", results, err)
	}
	fileURL := "file://" + filepath.ToSlash(workDir)
	completion := func(turn, call, cwd string) map[string]any {
		item := map[string]any{
			"type": "CommandExecution", "id": call, "status": "completed", "exit_code": 0,
			"parsed_cmd": []any{map[string]any{"type": "read", "name": "SKILL.md", "path": ".agents/skills/runtime-proof/SKILL.md"}},
		}
		if cwd != "" {
			item["cwd"] = cwd
		}
		return map[string]any{"type": "event_msg", "payload": map[string]any{
			"type": "item_completed", "thread_id": "relative-session", "turn_id": turn, "item": item,
		}}
	}
	first, _ := json.Marshal(completion("turn-same-cwd", "call-same-cwd", fileURL))
	second, _ := json.Marshal(completion("turn-unrelated-cwd", "call-unrelated-cwd", "file://"+filepath.ToSlash(decoyCWD)))
	third, _ := json.Marshal(completion("turn-missing-cwd", "call-missing-cwd", ""))
	file, err := os.OpenFile(transcript, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(append(first, '\n')); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if _, err := file.Write(append(second, '\n')); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if _, err := file.Write(append(third, '\n')); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	result, err := store.ReconcileTranscripts(context.Background(), []transcriptPath{{path: transcript, agent: "codex"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Queued != 1 || result.Scanned != 3 {
		t.Fatalf("relative reconciliation=%#v, want one same-CWD read", result)
	}
	var ref string
	if err := store.db.QueryRow(`SELECT skill_id FROM events WHERE status='pending'`).Scan(&ref); err != nil {
		t.Fatal(err)
	}
	if ref != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("captured skill_id=%q", ref)
	}
}

func TestCodexStructuredPathDecodingHandlesFileURIsAndRequiresCWDForRelativePaths(t *testing.T) {
	decoded, absolute := decodeCodexPath("file:///tmp/codex%20project/%C3%A9quipe")
	if !absolute || decoded != filepath.Clean("/tmp/codex project/équipe") {
		t.Fatalf("decoded POSIX file URI=%q absolute=%v", decoded, absolute)
	}
	windows, absolute := decodeCodexPath("file:///C:/Users/test%20user/Skill%20Pack")
	if !absolute || !codexPathIsAbsolute(windows) {
		t.Fatalf("decoded Windows file URI=%q absolute=%v", windows, absolute)
	}
	command := map[string]any{"path": ".agents/skills/demo/SKILL.md"}
	if resolved := resolveCodexReadPath(command, map[string]any{}, map[string]any{}); resolved != "" {
		t.Fatalf("relative read without structured CWD resolved to %q", resolved)
	}
}

func TestDefaultReconciliationUsesOnlyHookRegisteredTranscripts(t *testing.T) {
	t.Setenv("SKILLPACK_RUNTIME_NO_WAKE", "1")
	stateDir := t.TempDir()
	skillDir := filepath.Join(t.TempDir(), "example")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	registered := filepath.Join(t.TempDir(), "registered-session.jsonl")
	unregistered := filepath.Join(t.TempDir(), "unregistered-session.jsonl")
	initial := []byte(`{"type":"event_msg","payload":{"type":"session_meta","thread_id":"registered-session"}}` + "\n")
	if err := os.WriteFile(registered, initial, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(unregistered, initial, 0o600); err != nil {
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
	hook, _ := json.Marshal(map[string]any{"hook_event_name": "SessionStart", "session_id": "registered-session", "transcript_path": registered})
	if results, err := store.HandleHook(context.Background(), "codex", bytes.NewReader(hook)); err != nil || len(results) != 1 || results[0].Reason != "session_enrolled" {
		t.Fatalf("session start=%#v err=%v", results, err)
	}
	completion := map[string]any{
		"type": "event_msg",
		"payload": map[string]any{
			"type": "item_completed", "thread_id": "registered-session", "turn_id": "turn-registered",
			"item": map[string]any{
				"type": "CommandExecution", "id": "command-registered", "status": "completed", "exit_code": 0,
				"parsed_cmd": []any{map[string]any{"type": "read", "name": "SKILL.md", "path": filepath.Join(skillDir, "SKILL.md")}},
			},
		},
	}
	completionData, _ := json.Marshal(completion)
	for _, path := range []string{registered, unregistered} {
		file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write(append(completionData, '\n')); err != nil {
			_ = file.Close()
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
	}
	result, err := store.ReconcileDefaultTranscripts(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Queued != 1 || result.Scanned != 1 {
		t.Fatalf("default reconciliation=%#v, want only the registered transcript", result)
	}
	var cursors int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM cursors`).Scan(&cursors); err != nil {
		t.Fatal(err)
	}
	if cursors != 1 {
		t.Fatalf("cursor count=%d, want only hook-registered path", cursors)
	}
	var pending int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM events WHERE status='pending'`).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != 1 {
		t.Fatalf("pending count=%d, want 1", pending)
	}
}

func TestFutureTranscriptPathIsRegisteredBeforeTheFileExists(t *testing.T) {
	t.Setenv("SKILLPACK_RUNTIME_NO_WAKE", "1")
	stateDir := t.TempDir()
	skillDir := filepath.Join(t.TempDir(), "example")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	transcript := filepath.Join(t.TempDir(), "future-session.jsonl")
	store, err := OpenStore(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err := store.RegisterInventory(Inventory{SchemaVersion: 1, Origins: []string{"https://skillpack.app"}, Skills: []InventorySkill{{Path: skillDir, SkillID: "11111111-1111-4111-8111-111111111111", Version: "1.0.0", Origin: "https://skillpack.app"}}}); err != nil {
		t.Fatal(err)
	}
	hook, _ := json.Marshal(map[string]any{"hook_event_name": "SessionStart", "session_id": "future-session", "transcript_path": transcript})
	if results, err := store.HandleHook(context.Background(), "codex", bytes.NewReader(hook)); err != nil || len(results) != 1 || results[0].Reason != "session_enrolled" {
		t.Fatalf("session start=%#v err=%v", results, err)
	}
	var offset int64
	var initialized int
	var agent, sessionID string
	if err := store.db.QueryRow(`SELECT offset, initialized, agent, session_id FROM cursors WHERE path=?`, transcript).Scan(&offset, &initialized, &agent, &sessionID); err != nil {
		t.Fatal(err)
	}
	if offset != 0 || initialized != 0 || agent != "codex" || sessionID != "future-session" {
		t.Fatalf("future cursor=(offset=%d initialized=%d agent=%q session=%q), want zero uninitialized cursor", offset, initialized, agent, sessionID)
	}
	completion := map[string]any{
		"type": "event_msg",
		"payload": map[string]any{
			"type": "item_completed", "thread_id": "future-session", "turn_id": "turn-future",
			"item": map[string]any{
				"type": "CommandExecution", "id": "command-future", "status": "completed", "exit_code": 0,
				"parsed_cmd": []any{map[string]any{"type": "read", "name": "SKILL.md", "path": filepath.Join(skillDir, "SKILL.md")}},
			},
		},
	}
	completionData, _ := json.Marshal(completion)
	if err := os.WriteFile(transcript, append(completionData, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	result, err := store.ReconcileDefaultTranscripts(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Queued != 1 || result.Scanned != 1 {
		t.Fatalf("future transcript reconciliation=%#v, want one newly created signal", result)
	}
	var pending int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM events WHERE status='pending'`).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != 1 {
		t.Fatalf("pending events=%d, want 1", pending)
	}
}

func TestTranscriptPathReuseReassignsOptedOutSessionBeforeReconciliation(t *testing.T) {
	t.Setenv("SKILLPACK_RUNTIME_NO_WAKE", "1")
	stateDir := t.TempDir()
	skillDir := filepath.Join(t.TempDir(), "example")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	transcript := filepath.Join(t.TempDir(), "reused-path.jsonl")
	if err := os.WriteFile(transcript, []byte(`{"type":"session_meta","session_id":"old-session"}`+"\n"), 0o600); err != nil {
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
	start := func(session string) []byte {
		value, _ := json.Marshal(map[string]any{"hook_event_name": "SessionStart", "session_id": session, "transcript_path": transcript})
		return value
	}
	if results, err := store.HandleHook(context.Background(), "claude-code", bytes.NewReader(start("old-session"))); err != nil || len(results) != 1 || results[0].Reason != "session_enrolled" {
		t.Fatalf("old session start=%#v err=%v", results, err)
	}
	t.Setenv("SKILLPACK_TELEMETRY", "0")
	if results, err := store.HandleHook(context.Background(), "claude-code", bytes.NewReader(start("new-opted-out-session"))); err != nil || len(results) != 1 || results[0].Reason != "environment_opt_out" {
		t.Fatalf("opt-out session start=%#v err=%v", results, err)
	}
	if err := os.Unsetenv("SKILLPACK_TELEMETRY"); err != nil {
		t.Fatal(err)
	}
	lines := []string{
		`{"type":"assistant","message":{"content":[{"type":"tool_use","id":"reused-path-call","name":"Skill","input":{"skill":"` + skillDir + `"}}]}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"reused-path-call","is_error":false}]}}`,
	}
	file, err := os.OpenFile(transcript, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range lines {
		if _, err := file.WriteString(line + "\n"); err != nil {
			_ = file.Close()
			t.Fatal(err)
		}
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	result, err := store.ReconcileDefaultTranscripts(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Queued != 0 {
		t.Fatalf("reconciliation after path reuse=%#v, want no capture", result)
	}
	var sessionID string
	if err := store.db.QueryRow(`SELECT session_id FROM cursors WHERE path=?`, transcript).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if sessionID != "new-opted-out-session" {
		t.Fatalf("cursor session=%q, want opted-out replacement session", sessionID)
	}
	var enabled int
	if err := store.db.QueryRow(`SELECT enabled FROM session_policies WHERE session_id=?`, "new-opted-out-session").Scan(&enabled); err != nil {
		t.Fatal(err)
	}
	if enabled != 0 {
		t.Fatalf("replacement session policy=%d, want disabled", enabled)
	}
}

func TestTranscriptAnchorDetectsEqualOrLargerReplacementButNotAppend(t *testing.T) {
	t.Setenv("SKILLPACK_RUNTIME_NO_WAKE", "1")
	stateDir := t.TempDir()
	skillDir := filepath.Join(t.TempDir(), "example")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	transcript := filepath.Join(t.TempDir(), "rotation-session.jsonl")
	initial := []byte(`{"type":"session_meta","session_id":"rotation-session"}` + "\n")
	if err := os.WriteFile(transcript, initial, 0o600); err != nil {
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
	start, _ := json.Marshal(map[string]any{"hook_event_name": "SessionStart", "session_id": "rotation-session", "transcript_path": transcript})
	if results, err := store.HandleHook(context.Background(), "claude-code", bytes.NewReader(start)); err != nil || len(results) != 1 || results[0].Reason != "session_enrolled" {
		t.Fatalf("session start=%#v err=%v", results, err)
	}
	path := transcriptPath{path: transcript, agent: "claude-code"}
	appendSignal := func(callID string) {
		file, openErr := os.OpenFile(transcript, os.O_APPEND|os.O_WRONLY, 0o600)
		if openErr != nil {
			t.Fatal(openErr)
		}
		lines := []string{
			`{"type":"assistant","message":{"content":[{"type":"tool_use","id":"` + callID + `","name":"Skill","input":{"skill":"` + skillDir + `"}}]}}`,
			`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"` + callID + `","is_error":false}]}}`,
		}
		for _, line := range lines {
			if _, writeErr := file.WriteString(line + "\n"); writeErr != nil {
				_ = file.Close()
				t.Fatal(writeErr)
			}
		}
		if closeErr := file.Close(); closeErr != nil {
			t.Fatal(closeErr)
		}
	}
	appendSignal("append-call")
	appended, err := store.ReconcileTranscripts(context.Background(), []transcriptPath{path})
	if err != nil {
		t.Fatal(err)
	}
	if appended.Queued != 1 || appended.Diagnostics != 0 {
		t.Fatalf("normal append reconciliation=%#v, want one capture without rotation", appended)
	}
	// Replace the file with a different payload that is larger than the old
	// file. A size-only check would seek into this new transcript and miss it.
	replacement := []byte(`{"type":"assistant","message":{"content":[{"type":"tool_use","id":"replacement-call","name":"Skill","input":{"skill":"` + skillDir + `"}}]}}` + "\n" + `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"replacement-call","is_error":false}]}}` + "\n")
	var previousSize int64
	if info, statErr := os.Stat(transcript); statErr != nil {
		t.Fatal(statErr)
	} else {
		previousSize = info.Size()
	}
	if int64(len(replacement)) <= previousSize {
		replacement = append(replacement, []byte("replacement padding to remain larger than the prior transcript\n")...)
	}
	if err := os.WriteFile(transcript, replacement, 0o600); err != nil {
		t.Fatal(err)
	}
	replaced, err := store.ReconcileTranscripts(context.Background(), []transcriptPath{path})
	if err != nil {
		t.Fatal(err)
	}
	if replaced.Queued != 1 || replaced.Diagnostics == 0 {
		t.Fatalf("equal-or-larger replacement reconciliation=%#v, want one capture with rotation", replaced)
	}
}
