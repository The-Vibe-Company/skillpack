package runtime

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type hookSignal struct {
	Kind           string
	SkillRef       string
	SessionID      string
	TurnID         string
	CallID         string
	InstanceID     string
	TranscriptPath string
	ObservedAt     time.Time
	Source         string
}

func readHookJSON(in io.Reader) ([]map[string]any, error) {
	if in == nil {
		return nil, errors.New("hook input is required")
	}
	data, err := io.ReadAll(io.LimitReader(in, maxHookInputBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxHookInputBytes {
		return nil, errors.New("hook input exceeds 2 MiB")
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, fmt.Errorf("invalid hook JSON: %w", err)
	}
	switch item := value.(type) {
	case map[string]any:
		return []map[string]any{item}, nil
	case []any:
		result := make([]map[string]any, 0, len(item))
		for _, raw := range item {
			object, ok := raw.(map[string]any)
			if !ok {
				return nil, errors.New("hook JSON array must contain objects")
			}
			result = append(result, object)
		}
		return result, nil
	default:
		return nil, errors.New("hook JSON must be an object or array")
	}
}

func stringField(object map[string]any, names ...string) string {
	for _, name := range names {
		if value, ok := object[name].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func failureField(object map[string]any) (bool, bool) {
	for _, name := range []string{"is_error", "isError", "error"} {
		if raw, exists := object[name]; exists {
			switch value := raw.(type) {
			case bool:
				return value, true
			case string:
				normalized := strings.ToLower(strings.TrimSpace(value))
				if normalized == "" || normalized == "false" || normalized == "none" || normalized == "no" || normalized == "ok" || normalized == "success" {
					return false, true
				}
				return true, true
			}
		}
	}
	for _, name := range []string{"success", "succeeded"} {
		if raw, exists := object[name]; exists {
			switch value := raw.(type) {
			case bool:
				return !value, true
			case string:
				normalized := strings.ToLower(strings.TrimSpace(value))
				return !(normalized == "true" || normalized == "yes" || normalized == "ok" || normalized == "success" || normalized == "succeeded"), true
			}
		}
	}
	status := strings.ToLower(stringField(object, "status"))
	if status == "failed" || status == "failure" || status == "error" {
		return true, true
	}
	if status == "success" || status == "succeeded" || status == "ok" || status == "complete" || status == "completed" {
		return false, true
	}
	return false, false
}

func nestedObject(object map[string]any, names ...string) []map[string]any {
	var result []map[string]any
	for _, name := range names {
		if nested, ok := object[name].(map[string]any); ok {
			result = append(result, nested)
		}
	}
	return result
}

func findStructuredSkillRef(object map[string]any) string {
	if ref := stringField(object, "skill_id", "skill_path", "skill", "skill_name", "qualified_skill"); ref != "" {
		return ref
	}
	for _, nested := range nestedObject(object, "tool_input", "input", "arguments", "tool", "data", "event", "params", "tool_response", "result") {
		if ref := stringField(nested, "skill_id", "skill_path", "skill", "skill_name", "qualified_skill", "command_name", "commandName"); ref != "" {
			return ref
		}
	}
	return ""
}

func isSkillManifestPath(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	// Normalize both separators so a Windows path remains recognizable when
	// fixtures or forwarded hook records are parsed on another host.
	return filepath.Base(filepath.Clean(strings.ReplaceAll(value, `\`, "/"))) == "SKILL.md"
}

func parseObservedAt(object map[string]any) time.Time {
	value := stringField(object, "observed_at", "timestamp", "created_at")
	if value == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}
	}
	return parsed.UTC()
}

func parseHookSignal(agent string, object map[string]any) (hookSignal, bool) {
	eventName := strings.ToLower(stringField(object, "hook_event_name", "event", "event_type", "type", "name"))
	toolName := strings.ToLower(stringField(object, "tool_name", "tool", "operation"))
	if toolName == "" {
		for _, nested := range nestedObject(object, "tool", "data") {
			toolName = strings.ToLower(stringField(nested, "name", "tool_name", "type"))
			if toolName != "" {
				break
			}
		}
	}
	ref := findStructuredSkillRef(object)
	// Claude's UserPromptExpansion payload carries slash commands in
	// command_name. Prompt text is never inspected or matched here.
	if ref == "" && strings.Contains(eventName, "userpromptexpansion") && strings.EqualFold(stringField(object, "expansion_type", "expansionType"), "slash_command") {
		ref = stringField(object, "command_name", "commandName")
	}
	isReadSignal := toolName == "read" || strings.Contains(eventName, "read")
	if isReadSignal && !isSkillManifestPath(ref) {
		ref = ""
	}
	if ref == "" && isReadSignal {
		ref = ""
		for _, nested := range nestedObject(object, "tool_input", "input", "arguments", "tool_response", "result") {
			candidate := stringField(nested, "file_path", "path", "file", "skill_path")
			if isSkillManifestPath(candidate) {
				ref = candidate
				break
			}
		}
	}
	if ref == "" {
		return hookSignal{}, false
	}
	kind := strings.ToLower(stringField(object, "kind", "event_kind", "signal_kind"))
	if kind == "" {
		switch {
		case strings.Contains(eventName, "userprompt") || strings.Contains(eventName, "request") || strings.Contains(eventName, "prompt"):
			kind = "request"
		case toolName == "skill" || toolName == "skill_invocation" || eventName == "skill" || strings.Contains(eventName, "skill_invocation") || strings.Contains(eventName, "invocation") || strings.Contains(eventName, "after_tool"):
			kind = "invocation"
		case toolName == "read" || strings.Contains(eventName, "read"):
			kind = "read"
		}
	}
	if !validKinds[kind] {
		return hookSignal{}, false
	}
	if failed, known := failureField(object); known && failed {
		return hookSignal{}, false
	}
	for _, nested := range nestedObject(object, "tool_response", "result", "output", "tool_output") {
		if failed, known := failureField(nested); known && failed {
			return hookSignal{}, false
		}
	}
	if strings.Contains(eventName, "failure") || strings.Contains(eventName, "error") || strings.Contains(eventName, "failed") {
		return hookSignal{}, false
	}
	return hookSignal{
		Kind:           kind,
		SkillRef:       ref,
		SessionID:      stringField(object, "session_id", "sessionId", "conversation_id"),
		TurnID:         stringField(object, "turn_id", "turnId", "response_id", "prompt_id", "promptId"),
		CallID:         stringField(object, "call_id", "callId", "tool_use_id", "toolUseId", "invocation_id", "id"),
		InstanceID:     stringField(object, "instance_id", "instanceId"),
		TranscriptPath: stringField(object, "transcript_path", "transcriptPath"),
		ObservedAt:     parseObservedAt(object),
		Source:         "hook",
	}, true
}

func hookEventName(object map[string]any) string {
	name := strings.ToLower(stringField(object, "hook_event_name", "event", "event_type", "type", "name"))
	name = strings.ReplaceAll(name, "_", "")
	name = strings.ReplaceAll(name, "-", "")
	return strings.ReplaceAll(name, ".", "")
}

func recognizedHookActivity(object map[string]any) bool {
	switch hookEventName(object) {
	case "sessionstart", "userpromptsubmit", "stop", "sessionstop", "subagentstart", "posttooluse", "posttoolusefailure", "userpromptexpansion", "chatmessage", "toolexecuteafter":
		return true
	default:
		return false
	}
}

// normalizeOpenCodeHook translates OpenCode's native plugin callbacks into the
// small, structured hook envelope shared by the other adapters. The runtime
// deliberately reads only session/call IDs and Skill metadata; args, output
// text, and titles are never interpreted or copied into a local event.
func normalizeOpenCodeHook(object map[string]any) map[string]any {
	if object == nil {
		return nil
	}
	// A packaged plugin normally emits the common envelope directly. Keep it
	// intact so the ordinary parser remains the single capture boundary.
	if stringField(object, "hook_event_name") != "" {
		return object
	}
	eventName := hookEventName(object)
	properties, _ := object["properties"].(map[string]any)
	if properties == nil {
		properties = object
	}
	sessionID := stringField(properties, "sessionID", "session_id", "threadID", "thread_id")
	switch eventName {
	case "chatmessage":
		return map[string]any{
			"hook_event_name": "SessionStart",
			"session_id":      sessionID,
		}
	case "toolexecuteafter":
		input, _ := object["input"].(map[string]any)
		if input == nil {
			input = properties
		}
		if !strings.EqualFold(stringField(input, "tool", "tool_name"), "skill") {
			return map[string]any{"hook_event_name": "Unknown"}
		}
		if inputSession := stringField(input, "sessionID", "session_id", "threadID", "thread_id"); inputSession != "" {
			sessionID = inputSession
		}
		output, _ := object["output"].(map[string]any)
		metadata, _ := output["metadata"].(map[string]any)
		if output == nil || metadata == nil {
			return map[string]any{"hook_event_name": "Unknown"}
		}
		if failed, known := failureField(output); known && failed {
			return map[string]any{"hook_event_name": "Unknown"}
		}
		ref := stringField(metadata, "dir")
		name := stringField(metadata, "name")
		callID := stringField(input, "callID", "call_id")
		if ref == "" || name == "" || callID == "" {
			return map[string]any{"hook_event_name": "Unknown"}
		}
		return map[string]any{
			"hook_event_name": "PostToolUse",
			"session_id":      sessionID,
			"tool_name":       "Skill",
			"tool_use_id":     callID,
			"tool_input":      map[string]any{"skill": ref},
			"tool_response":   map[string]any{"success": true, "commandName": name},
		}
	default:
		return object
	}
}

func hookSessionID(object map[string]any) string {
	return stringField(object, "session_id", "sessionId", "conversation_id", "thread_id", "threadId")
}

func hookTranscriptPath(object map[string]any) string {
	return stringField(object, "transcript_path", "transcriptPath")
}

func (s *Store) markHookObserved(ctx context.Context, agent string, observedAt time.Time) error {
	if !validAgents[agent] {
		return fmt.Errorf("unsupported agent %q", agent)
	}
	if observedAt.IsZero() {
		observedAt = nowUTC()
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, "last_hook_"+agent, formatTime(observedAt))
	return err
}

// enrollHookSession persists consent before transcript reconciliation. A
// false policy is sticky for the life of a session, including when a later
// process no longer carries the environment opt-out variable.
func (s *Store) enrollHookSession(ctx context.Context, sessionID, source string) (CaptureResult, error) {
	if strings.TrimSpace(sessionID) == "" {
		return CaptureResult{Reason: "session_activity"}, nil
	}
	if telemetryDisabledForProcess() {
		if err := s.rememberSession(ctx, sessionID, false, "environment"); err != nil {
			return CaptureResult{}, err
		}
		if err := s.purgeSession(ctx, sessionID); err != nil {
			return CaptureResult{}, err
		}
		return CaptureResult{Reason: "environment_opt_out"}, nil
	}
	allowed, known, err := s.sessionAllowed(ctx, sessionID)
	if err != nil {
		return CaptureResult{}, err
	}
	if known {
		if !allowed {
			return CaptureResult{Reason: "session_opt_out"}, nil
		}
		return CaptureResult{Reason: "session_active"}, nil
	}
	if err := s.rememberSession(ctx, sessionID, true, source); err != nil {
		return CaptureResult{}, err
	}
	return CaptureResult{Reason: "session_enrolled"}, nil
}

func adapterForAgent(agent string) string {
	if agent == "claude-code" {
		return "claude-hook"
	}
	if agent == "opencode" {
		return "opencode-plugin"
	}
	return "codex-hook"
}

func (s *Store) HandleHook(ctx context.Context, agent string, in io.Reader) ([]CaptureResult, error) {
	if !validAgents[agent] {
		return nil, fmt.Errorf("unsupported agent %q", agent)
	}
	objects, err := readHookJSON(in)
	if err != nil {
		return nil, err
	}
	results := make([]CaptureResult, 0, len(objects))
	validActivity := false
	for _, object := range objects {
		parsedObject := object
		if agent == "opencode" {
			parsedObject = normalizeOpenCodeHook(object)
		}
		signal, ok := parseHookSignal(agent, parsedObject)
		activity := recognizedHookActivity(parsedObject) || ok
		if activity {
			validActivity = true
			if err := s.markHookObserved(ctx, agent, signal.ObservedAt); err != nil {
				return nil, err
			}
		}
		sessionID := hookSessionID(parsedObject)
		if sessionID == "" {
			sessionID = signal.SessionID
		}
		var enrollment CaptureResult
		if activity && sessionID != "" {
			var enrollErr error
			enrollment, enrollErr = s.enrollHookSession(ctx, sessionID, "hook")
			if enrollErr != nil {
				return nil, enrollErr
			}
			eventName := hookEventName(parsedObject)
			if eventName == "sessionstart" || eventName == "userpromptsubmit" {
				if path := hookTranscriptPath(parsedObject); path != "" {
					if err := s.baselineTranscript(ctx, path, sessionID, agent); err != nil {
						s.addDiagnostic("transcript_baseline_failed", err.Error())
					}
				}
			}
		}
		if !ok {
			result := CaptureResult{Reason: "unsupported_signal"}
			eventName := hookEventName(parsedObject)
			if activity && (eventName == "sessionstart" || eventName == "userpromptsubmit" || eventName == "stop" || eventName == "sessionstop") {
				if sessionID == "" {
					result.Reason = "session_activity"
				} else {
					result = enrollment
				}
			}
			if telemetryDisabledForProcess() && sessionID != "" {
				// Preserve the legacy behavior for recognized payloads without a
				// skill ref; the policy is intentionally sticky.
				_ = s.rememberSession(ctx, sessionID, false, "environment")
				_ = s.purgeSession(ctx, sessionID)
			}
			results = append(results, result)
			continue
		}
		result, captureErr := s.CaptureEvent(ctx, CaptureInput{
			SkillRef:    signal.SkillRef,
			Kind:        signal.Kind,
			Adapter:     adapterForAgent(agent),
			Agent:       agent,
			Environment: currentEnvironment(),
			SessionID:   nonEmpty(signal.SessionID, sessionID),
			TurnID:      signal.TurnID,
			CallID:      signal.CallID,
			InstanceID:  signal.InstanceID,
			Source:      signal.Source,
			ObservedAt:  signal.ObservedAt,
		})
		if captureErr != nil {
			if errors.Is(captureErr, errQueueFull) {
				result.Reason = "queue_full"
			} else {
				return nil, captureErr
			}
		}
		results = append(results, result)
	}
	if validActivity && os.Getenv("SKILLPACK_RUNTIME_NO_WAKE") != "1" {
		if err := wakeWorker(s.stateDir); err != nil {
			s.addDiagnostic("worker_wake_failed", err.Error())
		}
	}
	return results, nil
}

func wakeWorker(stateDir string) error {
	if strings.TrimSpace(os.Getenv("SKILLPACK_RUNTIME_WORKER")) == "1" {
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if filepath.Base(exe) == "" || strings.Contains(filepath.Base(exe), ".test") {
		return nil
	}
	cmd := exec.Command(exe, "--state-dir", stateDir, "worker")
	cmd.Env = append(os.Environ(), "SKILLPACK_RUNTIME_WORKER=1")
	cmd.Stdin = nil
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	return cmd.Start()
}

func writeHookResult(out io.Writer, results []CaptureResult) error {
	if len(results) == 1 {
		return json.NewEncoder(out).Encode(results[0])
	}
	var captured, skipped int
	for _, result := range results {
		if result.Captured {
			captured++
		} else {
			skipped++
		}
	}
	return json.NewEncoder(out).Encode(map[string]any{"captured": captured, "skipped": skipped, "results": results})
}

func scanLines(r io.Reader, visit func([]byte) error) error {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 4096), maxHookInputBytes)
	for scanner.Scan() {
		if err := visit(scanner.Bytes()); err != nil {
			return err
		}
	}
	return scanner.Err()
}
