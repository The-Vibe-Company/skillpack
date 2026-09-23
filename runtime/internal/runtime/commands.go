package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	stdRuntime "runtime"
	"strings"
	"syscall"
)

type stringList []string

func (list *stringList) String() string { return strings.Join(*list, ",") }

func (list *stringList) Set(value string) error {
	if strings.TrimSpace(value) == "" {
		return errors.New("path must not be empty")
	}
	*list = append(*list, value)
	return nil
}

func runSync(ctx context.Context, store *Store, args []string, out, errOut io.Writer) int {
	flags := flag.NewFlagSet("sync", flag.ContinueOnError)
	flags.SetOutput(errOut)
	var paths stringList
	flags.Var(&paths, "transcript", "explicit transcript JSONL path; may be repeated")
	agent := flags.String("agent", "claude-code", "agent for explicit transcript paths")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if !validAgents[*agent] {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime sync: --agent must be codex or claude-code")
		return 2
	}
	var explicit []transcriptPath
	if len(paths) > 0 {
		explicit = make([]transcriptPath, 0, len(paths))
		for _, path := range paths {
			explicit = append(explicit, transcriptPath{path: path, agent: *agent})
		}
	}
	result, err := store.syncOnce(ctx, &http.Client{Timeout: HTTPTimeout}, explicit)
	if err != nil {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime sync:", err)
		return 1
	}
	if err := json.NewEncoder(out).Encode(result); err != nil {
		return 1
	}
	return 0
}

func runWorker(ctx context.Context, store *Store, args []string, out, errOut io.Writer, continuous bool) int {
	flags := flag.NewFlagSet("worker", flag.ContinueOnError)
	flags.SetOutput(errOut)
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime worker: unexpected arguments")
		return 2
	}
	var cancel context.CancelFunc
	ctx, cancel = signalContext(ctx)
	defer cancel()
	result, err := store.runWorker(ctx, continuous, nil)
	if err != nil && !errors.Is(err, context.Canceled) {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime worker:", err)
		return 1
	}
	_ = json.NewEncoder(out).Encode(result)
	return 0
}

func runTelemetry(ctx context.Context, store *Store, args []string, out, errOut io.Writer) int {
	if len(args) != 1 || (args[0] != "enable" && args[0] != "disable") {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime telemetry: use enable or disable")
		return 2
	}
	enabled := args[0] == "enable"
	if err := store.setTelemetry(ctx, enabled); err != nil {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime telemetry:", err)
		return 1
	}
	_ = json.NewEncoder(out).Encode(map[string]any{"enabled": enabled})
	return 0
}

func runDoctor(ctx context.Context, store *Store, args []string, out, errOut io.Writer) int {
	flags := flag.NewFlagSet("doctor", flag.ContinueOnError)
	flags.SetOutput(errOut)
	jsonOutput := flags.Bool("json", false, "print JSON diagnostics")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime doctor: unexpected arguments")
		return 2
	}
	if !*jsonOutput {
		*jsonOutput = true
	}
	doctor, err := store.Doctor(ctx)
	if err != nil {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime doctor:", err)
		return 1
	}
	if *jsonOutput {
		if err := json.NewEncoder(out).Encode(doctor); err != nil {
			return 1
		}
	}
	return 0
}

func (s *Store) Doctor(ctx context.Context) (Doctor, error) {
	enabled, err := s.telemetryEnabled(ctx)
	if err != nil {
		return Doctor{}, err
	}
	if telemetryDisabledForProcess() {
		enabled = false
	}
	skills, origins, err := s.inventoryStats(ctx)
	if err != nil {
		return Doctor{}, err
	}
	queue, err := s.QueueStats(ctx)
	if err != nil {
		return Doctor{}, err
	}
	var lastCapture string
	_ = s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key='last_capture'`).Scan(&lastCapture)
	var transport TransportDoctor
	_ = s.db.QueryRowContext(ctx, `SELECT COALESCE(last_error, ''), COALESCE(last_status, 0), COALESCE(SUM(attempts), 0) FROM events WHERE last_error IS NOT NULL OR attempts > 0`).Scan(&transport.LastError, &transport.LastCode, &transport.Retries)
	diagnostics, err := s.diagnosticSummaries(ctx)
	if err != nil {
		return Doctor{}, err
	}
	platformSupported := (stdRuntime.GOOS == "darwin" || stdRuntime.GOOS == "linux" || stdRuntime.GOOS == "windows") && (stdRuntime.GOARCH == "amd64" || stdRuntime.GOARCH == "arm64")
	coverage := "standalone-runtime-only"
	if !platformSupported {
		coverage = "unsupported-platform"
	}
	hooks, err := s.hookDoctors()
	if err != nil {
		return Doctor{}, err
	}
	return Doctor{
		Version:     RuntimeVersion,
		StateDir:    s.stateDir,
		Telemetry:   TelemetryDoctor{Enabled: enabled},
		Inventory:   InventoryDoctor{Skills: skills, Origins: origins},
		Queue:       queue,
		LastCapture: lastCapture,
		Transport:   transport,
		Hooks:       hooks,
		Diagnostics: diagnostics,
		Runtime: RuntimeDoctor{
			Installed: true,
			Healthy:   platformSupported,
			Platform:  stdRuntime.GOOS + "/" + stdRuntime.GOARCH,
			Coverage:  coverage,
		},
	}, nil
}

func (s *Store) hookDoctors() (map[string]HookDoctor, error) {
	configured := map[string]bool{"codex": false, "claude-code": false, "opencode": false}
	markerPath := filepath.Join(s.stateDir, "hook-setup.json")
	if info, err := os.Lstat(markerPath); err == nil && info.Mode().IsRegular() {
		if data, readErr := os.ReadFile(markerPath); readErr == nil {
			var marker struct {
				SchemaVersion int             `json:"schemaVersion"`
				Agents        map[string]bool `json:"agents"`
			}
			if json.Unmarshal(data, &marker) == nil && marker.SchemaVersion == 1 {
				for agent, value := range marker.Agents {
					if _, known := configured[agent]; known {
						configured[agent] = value
					}
				}
			}
		}
	}
	result := make(map[string]HookDoctor, len(configured))
	for _, agent := range []string{"codex", "claude-code", "opencode"} {
		var lastSeen string
		_ = s.db.QueryRow(`SELECT value FROM settings WHERE key=?`, "last_hook_"+agent).Scan(&lastSeen)
		status := "not_configured"
		if configured[agent] {
			status = "awaiting_real_hook"
			if strings.TrimSpace(lastSeen) != "" {
				status = "observed_hook"
			}
		}
		result[agent] = HookDoctor{Supported: true, Configured: configured[agent], Status: status, LastSeen: lastSeen}
	}
	return result, nil
}

func signalContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
}
