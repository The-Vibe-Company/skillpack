package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }

func TestSendPendingRequiresDurableMatchingReceiptAndUsesInventoryOrigin(t *testing.T) {
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
	_, err = store.RegisterInventory(Inventory{
		SchemaVersion: 1,
		Origins:       []string{"https://verified.example"},
		Skills:        []InventorySkill{{Path: skillDir, SkillID: "11111111-1111-4111-8111-111111111111", Version: "1.0.0", Origin: "https://verified.example"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	captured, err := store.CaptureEvent(context.Background(), CaptureInput{SkillRef: skillDir, Kind: "read", Adapter: "codex-hook", Agent: "codex", Environment: "local", SessionID: "session", TurnID: "turn", CallID: "call", Source: "hook"})
	if err != nil || !captured.Captured {
		t.Fatalf("capture = %#v, err=%v", captured, err)
	}
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != "https://verified.example/v1/skill-usage-events" {
			t.Fatalf("request URL = %s", request.URL)
		}
		body, _ := io.ReadAll(request.Body)
		if strings.Contains(string(body), "session") || strings.Contains(string(body), "path") {
			t.Fatalf("wire body leaked local data: %s", body)
		}
		return &http.Response{StatusCode: http.StatusAccepted, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"event_id":"` + captured.EventID + `"}`))}, nil
	})}
	report, err := store.SendPending(context.Background(), client)
	if err != nil {
		t.Fatal(err)
	}
	if report.sent != 1 || report.retried != 0 {
		t.Fatalf("send report = %#v", report)
	}
	stats, err := store.QueueStats(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if stats.Pending != 0 || stats.Sent != 1 {
		t.Fatalf("queue stats = %#v", stats)
	}
}

func TestSendPendingRetriesOnlyRetryableResponses(t *testing.T) {
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
	_, err = store.RegisterInventory(Inventory{SchemaVersion: 1, Origins: []string{"https://verified.example"}, Skills: []InventorySkill{{Path: skillDir, SkillID: "11111111-1111-4111-8111-111111111111", Version: "1.0.0", Origin: "https://verified.example"}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CaptureEvent(context.Background(), CaptureInput{SkillRef: skillDir, Kind: "invocation", Adapter: "claude-hook", Agent: "claude-code", Environment: "local"}); err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusBadRequest, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":"invalid"}`))}, nil
	})}
	report, err := store.SendPending(context.Background(), client)
	if err != nil {
		t.Fatal(err)
	}
	if report.terminal != 1 || report.retried != 0 {
		t.Fatalf("terminal report = %#v", report)
	}

	if _, err := store.CaptureEvent(context.Background(), CaptureInput{SkillRef: skillDir, Kind: "request", Adapter: "claude-hook", Agent: "claude-code", Environment: "local"}); err != nil {
		t.Fatal(err)
	}
	retryClient := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusServiceUnavailable, Header: http.Header{"Retry-After": []string{"0"}}, Body: io.NopCloser(strings.NewReader(`{}`))}, nil
	})}
	report, err = store.SendPending(context.Background(), retryClient)
	if err != nil {
		t.Fatal(err)
	}
	if report.retried != 1 || report.terminal != 0 {
		t.Fatalf("retry report = %#v", report)
	}
}

func TestSendPendingProcessesAtMostFiveAndRetainsBoundedTombstones(t *testing.T) {
	store, skillDir := testStoreWithSkill(t)
	for i := 0; i < 6; i++ {
		captured, err := store.CaptureEvent(context.Background(), CaptureInput{SkillRef: skillDir, Kind: "read", Adapter: "codex-hook", Agent: "codex", Environment: "local", TurnID: fmt.Sprintf("turn-%d", i), CallID: fmt.Sprintf("call-%d", i), SessionID: "batch-session"})
		if err != nil || !captured.Captured {
			t.Fatalf("capture %d=%#v err=%v", i, captured, err)
		}
	}
	requests := 0
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		body, _ := io.ReadAll(request.Body)
		var event Event
		if err := json.Unmarshal(body, &event); err != nil {
			return nil, err
		}
		return &http.Response{StatusCode: http.StatusAccepted, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"event_id":"` + event.EventID + `"}`))}, nil
	})}
	report, err := store.SendPending(context.Background(), client)
	if err != nil {
		t.Fatal(err)
	}
	if requests != 5 || report.sent != 5 {
		t.Fatalf("batch requests=%d report=%#v", requests, report)
	}
	stats, err := store.QueueStats(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if stats.Pending != 1 || stats.Sent != 5 {
		t.Fatalf("batch queue=%#v", stats)
	}
	var payloadBytes int
	if err := store.db.QueryRow(`SELECT COALESCE(SUM(payload_bytes), 0) FROM events WHERE status IN ('sent','dead')`).Scan(&payloadBytes); err != nil {
		t.Fatal(err)
	}
	if payloadBytes != 0 {
		t.Fatalf("terminal payload bytes=%d, want tombstones without payload", payloadBytes)
	}
}

func TestSendPendingRechecksGlobalDisableBeforeEveryEvent(t *testing.T) {
	store, skillDir := testStoreWithSkill(t)
	for i := 0; i < 2; i++ {
		captured, err := store.CaptureEvent(context.Background(), CaptureInput{SkillRef: skillDir, Kind: "request", Adapter: "codex-hook", Agent: "codex", Environment: "local", TurnID: fmt.Sprintf("disable-turn-%d", i), CallID: fmt.Sprintf("disable-call-%d", i), SessionID: "disable-session"})
		if err != nil || !captured.Captured {
			t.Fatalf("capture %d=%#v err=%v", i, captured, err)
		}
	}
	requests := 0
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		var event Event
		body, _ := io.ReadAll(request.Body)
		if err := json.Unmarshal(body, &event); err != nil {
			return nil, err
		}
		if err := store.setTelemetry(context.Background(), false); err != nil {
			return nil, err
		}
		return &http.Response{StatusCode: http.StatusAccepted, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"event_id":"` + event.EventID + `"}`))}, nil
	})}
	if _, err := store.SendPending(context.Background(), client); err != nil {
		t.Fatal(err)
	}
	if requests != 1 {
		t.Fatalf("requests after mid-batch disable=%d, want 1", requests)
	}
	stats, err := store.QueueStats(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if stats.Pending != 0 || stats.Sent != 0 || stats.Dead != 0 {
		t.Fatalf("queue after mid-batch disable=%#v", stats)
	}
}

func TestTerminalTombstonesAreGloballyCapped(t *testing.T) {
	store, _ := testStoreWithSkill(t)
	tx, err := store.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < MaxQueueEvents+25; i++ {
		if _, err := tx.Exec(`INSERT INTO events(event_id, skill_id, version, kind, adapter, observed_at, agent, environment, endpoint, payload, payload_bytes, source, created_at, attempts, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'sent')`, fmt.Sprintf("sent-%05d", i), "11111111-1111-4111-8111-111111111111", "1.0.0", "read", "codex-hook", formatTime(nowUTC()), "codex", "local", "https://skillpack.app/v1/skill-usage-events", []byte("payload"), 7, "test", formatTime(nowUTC())); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := store.pruneBoundedState(context.Background()); err != nil {
		t.Fatal(err)
	}
	var count, payloadBytes int
	if err := store.db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(payload_bytes), 0) FROM events`).Scan(&count, &payloadBytes); err != nil {
		t.Fatal(err)
	}
	if count > MaxQueueEvents || payloadBytes > MaxQueueBytes {
		t.Fatalf("terminal bounds count=%d bytes=%d", count, payloadBytes)
	}
}
