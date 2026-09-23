package runtime

import "time"

const (
	RuntimeVersion       = "0.2.0"
	SchemaVersion        = 1
	MaxEventBytes        = 4 * 1024
	MaxQueueEvents       = 10_000
	MaxQueueBytes        = 50 * 1024 * 1024
	EventTTL             = 7 * 24 * time.Hour
	WorkerIdleTimeout    = 120 * time.Second
	HTTPTimeout          = 3 * time.Second
	DefaultHostedOrigin  = "https://skillpack.app"
	EventPath            = "/v1/skill-usage-events"
	maxHookInputBytes    = 2 * 1024 * 1024
	maxDiagnosticMessage = 512
)

var validKinds = map[string]bool{
	"invocation": true,
	"request":    true,
	"read":       true,
}

var validAgents = map[string]bool{
	"claude-code": true,
	"codex":       true,
	"opencode":    true,
}

var validEnvironments = map[string]bool{
	"conductor": true,
	"ci":        true,
	"sandbox":   true,
	"local":     true,
	"other":     true,
}

var validAdapters = map[string]bool{
	"claude-hook":       true,
	"claude-transcript": true,
	"codex-hook":        true,
	"codex-transcript":  true,
	"opencode-plugin":   true,
}

// Inventory is the verified set of Skillpack installations available to the
// runtime. Origins are trust anchors: hooks and transcripts cannot supply an
// arbitrary destination.
type Inventory struct {
	SchemaVersion int              `json:"schema_version"`
	Origins       []string         `json:"origins"`
	Skills        []InventorySkill `json:"skills"`
}

type InventorySkill struct {
	Path    string `json:"path"`
	SkillID string `json:"skill_id"`
	Version string `json:"version"`
	Origin  string `json:"origin"`
}

type Skill struct {
	Path          string
	CanonicalPath string
	SkillID       string
	Version       string
	Origin        string
}

// Event is exactly the wire contract. Local-only correlation fields never
// appear here and are stored separately in SQLite.
type Event struct {
	SchemaVersion int       `json:"schema_version"`
	EventID       string    `json:"event_id"`
	SkillID       string    `json:"skill_id"`
	Version       string    `json:"version"`
	Kind          string    `json:"kind"`
	Adapter       string    `json:"adapter"`
	ObservedAt    string    `json:"observed_at"`
	Agent         string    `json:"agent"`
	Environment   string    `json:"environment"`
	Identity      *Identity `json:"identity,omitempty"`
}

type Identity struct {
	UserID string `json:"user_id,omitempty"`
	Email  string `json:"email,omitempty"`
	Source string `json:"source"`
}

type localEvent struct {
	Event
	Endpoint    string
	Payload     []byte
	LocalKey    string
	SessionID   string
	Source      string
	CreatedAt   time.Time
	Attempts    int
	NextAttempt time.Time
	Status      string
}

type CaptureResult struct {
	Captured bool   `json:"captured"`
	EventID  string `json:"event_id,omitempty"`
	Kind     string `json:"kind,omitempty"`
	Reason   string `json:"reason,omitempty"`
}

type SyncResult struct {
	Scanned     int `json:"scanned"`
	Queued      int `json:"queued"`
	Sent        int `json:"sent"`
	Retried     int `json:"retried"`
	Terminal    int `json:"terminal"`
	Expired     int `json:"expired"`
	Diagnostics int `json:"diagnostics"`
}

type Doctor struct {
	Version     string                `json:"version"`
	StateDir    string                `json:"state_dir"`
	Telemetry   TelemetryDoctor       `json:"telemetry"`
	Inventory   InventoryDoctor       `json:"inventory"`
	Queue       QueueDoctor           `json:"queue"`
	LastCapture string                `json:"last_capture,omitempty"`
	Transport   TransportDoctor       `json:"transport"`
	Hooks       map[string]HookDoctor `json:"hooks"`
	Diagnostics []DiagnosticSummary   `json:"diagnostics,omitempty"`
	Runtime     RuntimeDoctor         `json:"runtime"`
}

type TelemetryDoctor struct {
	Enabled bool `json:"enabled"`
}

type InventoryDoctor struct {
	Skills  int `json:"skills"`
	Origins int `json:"origins"`
}

type QueueDoctor struct {
	Pending int   `json:"pending"`
	Bytes   int64 `json:"bytes"`
	Sent    int   `json:"sent"`
	Dead    int   `json:"dead"`
}

type TransportDoctor struct {
	LastError string `json:"last_error,omitempty"`
	LastCode  int    `json:"last_status,omitempty"`
	Retries   int    `json:"retries"`
}

type HookDoctor struct {
	Supported  bool   `json:"supported"`
	Configured bool   `json:"configured"`
	Status     string `json:"status"`
	LastSeen   string `json:"last_seen,omitempty"`
}

type RuntimeDoctor struct {
	Installed bool   `json:"installed"`
	Healthy   bool   `json:"healthy"`
	Platform  string `json:"platform"`
	Coverage  string `json:"coverage"`
}

type DiagnosticSummary struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Count     int    `json:"count"`
	UpdatedAt string `json:"updated_at"`
}
