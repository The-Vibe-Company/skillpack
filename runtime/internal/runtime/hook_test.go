package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClaudeHookCapturesStructuredSkillInvocationWithoutNetwork(t *testing.T) {
	t.Setenv("SKILLPACK_RUNTIME_NO_WAKE", "1")
	stateDir := t.TempDir()
	skillDir := filepath.Join(t.TempDir(), "official", "example")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	inventoryPath := filepath.Join(t.TempDir(), "inventory.json")
	inventory := Inventory{
		SchemaVersion: 1,
		Origins:       []string{"https://skillpack.app"},
		Skills:        []InventorySkill{{Path: skillDir, SkillID: "11111111-1111-4111-8111-111111111111", Version: "1.2.3", Origin: "https://skillpack.app"}},
	}
	data, err := json.Marshal(inventory)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(inventoryPath, data, 0o600); err != nil {
		t.Fatal(err)
	}
	var out, errOut bytes.Buffer
	if code := Run([]string{"--state-dir", stateDir, "register", "--inventory", inventoryPath}, bytes.NewReader(nil), &out, &errOut); code != 0 {
		t.Fatalf("register exited %d: %s", code, errOut.String())
	}
	hook := map[string]any{
		"hook_event_name": "PostToolUse",
		"session_id":      "session-1",
		"tool_name":       "Skill",
		"tool_input":      map[string]any{"skill": skillDir},
		"tool_response":   map[string]any{"is_error": false},
		"tool_use_id":     "call-1",
	}
	hookData, err := json.Marshal(hook)
	if err != nil {
		t.Fatal(err)
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"--state-dir", stateDir, "hook", "--agent", "claude-code"}, bytes.NewReader(hookData), &out, &errOut); code != 0 {
		t.Fatalf("hook exited %d: %s", code, errOut.String())
	}
	var result CaptureResult
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("hook output = %q: %v", out.String(), err)
	}
	if !result.Captured || result.Kind != "invocation" {
		t.Fatalf("hook result = %#v", result)
	}
	store, err := OpenStore(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	stats, err := store.QueueStats(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if stats.Pending != 1 {
		t.Fatalf("pending events = %d, want 1", stats.Pending)
	}
}

func TestTelemetryOptOutIsPersistedPerSessionBeforeLaterReconciliation(t *testing.T) {
	stateDir := t.TempDir()
	skillDir := filepath.Join(t.TempDir(), "official", "example")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
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
	hook, err := json.Marshal(map[string]any{
		"hook_event_name": "PostToolUse",
		"session_id":      "opt-out-session",
		"tool_name":       "Skill",
		"tool_input":      map[string]any{"skill": skillDir},
		"tool_use_id":     "call-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("SKILLPACK_TELEMETRY", "0")
	results, err := store.HandleHook(context.Background(), "claude-code", bytes.NewReader(hook))
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].Captured || results[0].Reason != "environment_opt_out" {
		t.Fatalf("opt-out result = %#v", results)
	}
	if err := os.Unsetenv("SKILLPACK_TELEMETRY"); err != nil {
		t.Fatal(err)
	}
	results, err = store.HandleHook(context.Background(), "claude-code", bytes.NewReader(hook))
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].Captured || results[0].Reason != "session_opt_out" {
		t.Fatalf("persisted opt-out result = %#v", results)
	}
	stats, err := store.QueueStats(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if stats.Pending != 0 {
		t.Fatalf("pending events after opt-out = %d", stats.Pending)
	}
}

func TestHookKindsStayDistinctAndFailuresAreNotInvocations(t *testing.T) {
	stateDir := t.TempDir()
	skillDir := filepath.Join(t.TempDir(), "skill")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
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
	request, _ := json.Marshal(map[string]any{"hook_event_name": "UserPromptSubmit", "session_id": "session", "skill": skillDir, "turn_id": "turn-request"})
	results, err := store.HandleHook(context.Background(), "claude-code", bytes.NewReader(request))
	if err != nil || len(results) != 1 || !results[0].Captured || results[0].Kind != "request" {
		t.Fatalf("request result = %#v, err=%v", results, err)
	}
	failure, _ := json.Marshal(map[string]any{"hook_event_name": "PostToolUseFailure", "session_id": "session", "tool_name": "Skill", "tool_input": map[string]any{"skill": skillDir}, "tool_response": map[string]any{"error": "failed"}, "tool_use_id": "call-failure"})
	results, err = store.HandleHook(context.Background(), "claude-code", bytes.NewReader(failure))
	if err != nil || len(results) != 1 || results[0].Captured || results[0].Reason != "unsupported_signal" {
		t.Fatalf("failure result = %#v, err=%v", results, err)
	}
	stats, err := store.QueueStats(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if stats.Pending != 1 {
		t.Fatalf("pending event kinds = %d, want request only", stats.Pending)
	}
}

func TestClaudeUserPromptExpansionUsesOfficialSlashCommandField(t *testing.T) {
	t.Setenv("SKILLPACK_RUNTIME_NO_WAKE", "1")
	stateDir := t.TempDir()
	skillDir := filepath.Join(t.TempDir(), "plan-pr")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
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
	input := []byte(`{"hook_event_name":"UserPromptExpansion","expansion_type":"slash_command","command_name":"plan-pr","command_source":"project","session_id":"slash-session","turn_id":"turn-1"}`)
	results, err := store.HandleHook(context.Background(), "claude-code", bytes.NewReader(input))
	if err != nil || len(results) != 1 {
		t.Fatalf("results=%#v err=%v", results, err)
	}
	if !results[0].Captured || results[0].Kind != "request" {
		t.Fatalf("slash expansion result=%#v", results[0])
	}
}

func TestClaudePostToolUseAcceptsPromptIDAndStructuredCommandName(t *testing.T) {
	t.Setenv("SKILLPACK_RUNTIME_NO_WAKE", "1")
	store, skillDir := testStoreWithSkill(t)
	input, _ := json.Marshal(map[string]any{
		"hook_event_name": "PostToolUse", "session_id": "real-claude-session", "prompt_id": "prompt-42",
		"tool_name": "Skill", "tool_use_id": "tool-42", "tool_response": map[string]any{"success": true, "commandName": filepath.Base(skillDir)},
	})
	results, err := store.HandleHook(context.Background(), "claude-code", bytes.NewReader(input))
	if err != nil || len(results) != 1 || !results[0].Captured || results[0].Kind != "invocation" {
		t.Fatalf("claude hook=%#v err=%v", results, err)
	}
	var localKey string
	if err := store.db.QueryRow(`SELECT local_key FROM events WHERE event_id=?`, results[0].EventID).Scan(&localKey); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(localKey, "prompt-42") || !strings.Contains(localKey, "tool-42") {
		t.Fatalf("local key=%q", localKey)
	}
}

func TestReadHooksRequireTheExactSkillManifestPath(t *testing.T) {
	t.Setenv("SKILLPACK_RUNTIME_NO_WAKE", "1")
	store, skillDir := testStoreWithSkill(t)
	readHook := func(path string) []byte {
		value, _ := json.Marshal(map[string]any{
			"hook_event_name": "PostToolUse",
			"session_id":      "read-path-session",
			"tool_name":       "Read",
			"tool_input":      map[string]any{"file_path": path},
			"tool_response":   map[string]any{"success": true},
			"tool_use_id":     path,
		})
		return value
	}
	for _, path := range []string{"README.md", filepath.Join(skillDir, "scripts", "install.py")} {
		results, err := store.HandleHook(context.Background(), "claude-code", bytes.NewReader(readHook(path)))
		if err != nil || len(results) != 1 || results[0].Captured || results[0].Reason != "unsupported_signal" {
			t.Fatalf("non-manifest read %q=%#v err=%v", path, results, err)
		}
	}
	manifest := filepath.Join(skillDir, "SKILL.md")
	results, err := store.HandleHook(context.Background(), "claude-code", bytes.NewReader(readHook(manifest)))
	if err != nil || len(results) != 1 || !results[0].Captured || results[0].Kind != "read" {
		t.Fatalf("manifest read=%#v err=%v", results, err)
	}
}

func TestSessionStartEnrollsBeforeTranscriptAndDoctorSeparatesObservation(t *testing.T) {
	t.Setenv("SKILLPACK_RUNTIME_NO_WAKE", "1")
	stateDir := t.TempDir()
	transcript := filepath.Join(t.TempDir(), "session.jsonl")
	initial := []byte(`{"type":"session_meta","session_id":"session-start"}` + "\n")
	if err := os.WriteFile(transcript, initial, 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := os.WriteFile(filepath.Join(stateDir, "hook-setup.json"), []byte(`{"schemaVersion":1,"agents":{"claude-code":true}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	input, err := json.Marshal(map[string]any{
		"hook_event_name": "SessionStart",
		"session_id":      "session-start",
		"transcript_path": transcript,
	})
	if err != nil {
		t.Fatal(err)
	}
	results, err := store.HandleHook(context.Background(), "claude-code", bytes.NewReader(input))
	if err != nil || len(results) != 1 || results[0].Reason != "session_enrolled" {
		t.Fatalf("session start result=%#v err=%v", results, err)
	}
	var enabled int
	if err := store.db.QueryRow(`SELECT enabled FROM session_policies WHERE session_id=?`, "session-start").Scan(&enabled); err != nil {
		t.Fatal(err)
	}
	if enabled != 1 {
		t.Fatalf("session policy=%d, want enabled", enabled)
	}
	var offset int64
	if err := store.db.QueryRow(`SELECT offset FROM cursors WHERE path=?`, transcript).Scan(&offset); err != nil {
		t.Fatal(err)
	}
	if offset != int64(len(initial)) {
		t.Fatalf("baseline offset=%d, want %d", offset, len(initial))
	}
	doctor, err := store.Doctor(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !doctor.Hooks["claude-code"].Configured || doctor.Hooks["claude-code"].Status != "observed_hook" {
		t.Fatalf("doctor hook state=%#v", doctor.Hooks["claude-code"])
	}
}

func TestOpenCodePluginEventsUseOnlyStructuredSuccessfulSkillMetadata(t *testing.T) {
	t.Setenv("SKILLPACK_RUNTIME_NO_WAKE", "1")
	store, skillDir := testStoreWithSkill(t)

	chatMessage, _ := json.Marshal(map[string]any{
		"event":     "chat.message",
		"sessionID": "opencode-session",
	})
	results, err := store.HandleHook(context.Background(), "opencode", bytes.NewReader(chatMessage))
	if err != nil || len(results) != 1 || results[0].Reason != "session_enrolled" {
		t.Fatalf("chat message=%#v err=%v", results, err)
	}

	toolAfter := map[string]any{
		"event": "tool.execute.after",
		"input": map[string]any{
			"tool":      "skill",
			"sessionID": "opencode-session",
			"callID":    "opencode-call",
			"args":      map[string]any{"name": "ignored-prompt-shaped-input"},
		},
		"output": map[string]any{
			"title":  "ignored title",
			"output": "prompt and tool output are never evidence",
			"metadata": map[string]any{
				"name": "example",
				"dir":  skillDir,
			},
		},
	}
	toolData, _ := json.Marshal(toolAfter)
	results, err = store.HandleHook(context.Background(), "opencode", bytes.NewReader(toolData))
	if err != nil || len(results) != 1 || !results[0].Captured || results[0].Kind != "invocation" {
		t.Fatalf("tool after=%#v err=%v", results, err)
	}
	firstEventID := results[0].EventID

	results, err = store.HandleHook(context.Background(), "opencode", bytes.NewReader(toolData))
	if err != nil || len(results) != 1 || results[0].Captured || results[0].Reason != "duplicate" || results[0].EventID != firstEventID {
		t.Fatalf("duplicate tool after=%#v err=%v", results, err)
	}

	ignored := []map[string]any{
		{
			"event":  "tool.execute.after",
			"input":  map[string]any{"tool": "shell", "sessionID": "opencode-session", "callID": "shell-call"},
			"output": map[string]any{"metadata": map[string]any{"name": "example", "dir": skillDir}},
		},
		{
			"event":  "tool.execute.after",
			"input":  map[string]any{"tool": "skill", "sessionID": "opencode-session", "callID": "failed-call"},
			"output": map[string]any{"error": "failed", "metadata": map[string]any{"name": "example", "dir": skillDir}},
		},
		{
			"event":  "tool.execute.after",
			"input":  map[string]any{"tool": "skill", "sessionID": "opencode-session", "callID": "text-call"},
			"output": map[string]any{"output": "example", "title": "example"},
		},
	}
	ignoredData, _ := json.Marshal(ignored)
	results, err = store.HandleHook(context.Background(), "opencode", bytes.NewReader(ignoredData))
	if err != nil || len(results) != len(ignored) {
		t.Fatalf("ignored events=%#v err=%v", results, err)
	}
	for index, result := range results {
		if result.Captured {
			t.Fatalf("ignored event %d captured: %#v", index, result)
		}
	}

	var adapter string
	if err := store.db.QueryRow(`SELECT adapter FROM events WHERE event_id=?`, firstEventID).Scan(&adapter); err != nil {
		t.Fatal(err)
	}
	if adapter != "opencode-plugin" {
		t.Fatalf("adapter=%q, want opencode-plugin", adapter)
	}
	var payload []byte
	if err := store.db.QueryRow(`SELECT payload FROM events WHERE event_id=?`, firstEventID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), "prompt-shaped-input") || strings.Contains(string(payload), "private instructions") || strings.Contains(string(payload), "ignored title") {
		t.Fatalf("OpenCode payload leaked callback text: %s", payload)
	}
	stats, err := store.QueueStats(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if stats.Pending != 1 {
		t.Fatalf("pending events=%d, want one invocation", stats.Pending)
	}
}
