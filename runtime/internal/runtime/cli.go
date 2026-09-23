package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
)

// Run executes the skillpack-runtime command line interface. It is kept as a
// small public seam so hook and doctor behavior can be tested without starting
// a child process.
func Run(args []string, in io.Reader, out, errOut io.Writer) int {
	stateDir, args, err := extractStateDir(args)
	if err != nil {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime:", err)
		return 2
	}
	if len(args) == 1 && (args[0] == "version" || args[0] == "--version") {
		_, _ = fmt.Fprintln(out, "skillpack-runtime "+RuntimeVersion)
		return 0
	}
	if len(args) == 0 || args[0] == "--help" || args[0] == "help" {
		writeUsage(out)
		return 0
	}
	store, err := OpenStore(stateDir)
	if err != nil {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime:", err)
		return 1
	}
	defer store.Close()

	ctx := context.Background()
	switch args[0] {
	case "register":
		return runRegister(ctx, store, args[1:], out, errOut)
	case "hook":
		return runHook(ctx, store, args[1:], in, out, errOut)
	case "sync":
		return runSync(ctx, store, args[1:], out, errOut)
	case "worker":
		return runWorker(ctx, store, args[1:], out, errOut, false)
	case "watch":
		return runWorker(ctx, store, args[1:], out, errOut, true)
	case "doctor":
		return runDoctor(ctx, store, args[1:], out, errOut)
	case "telemetry":
		return runTelemetry(ctx, store, args[1:], out, errOut)
	default:
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime: unknown command "+args[0])
		return 2
	}
}

func extractStateDir(args []string) (string, []string, error) {
	var stateDir string
	remaining := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--state-dir":
			if i+1 >= len(args) {
				return "", nil, errors.New("--state-dir requires a path")
			}
			i++
			stateDir = args[i]
		case strings.HasPrefix(arg, "--state-dir="):
			stateDir = strings.TrimPrefix(arg, "--state-dir=")
			if stateDir == "" {
				return "", nil, errors.New("--state-dir requires a path")
			}
		default:
			remaining = append(remaining, arg)
		}
	}
	return stateDir, remaining, nil
}

func writeUsage(out io.Writer) {
	_, _ = fmt.Fprintln(out, `skillpack-runtime 0.1.0

Usage: skillpack-runtime [--state-dir PATH] <command>

Commands:
  version | --version       print the runtime version
  register --inventory PATH register verified skill inventory
  hook --agent AGENT        capture one official hook JSON event from stdin
  sync                      reconcile known transcripts and send queued events once
  worker                    send queued events until 120 seconds idle
  watch                     continuously reconcile and send until interrupted
  doctor --json             print local health and coverage diagnostics
  telemetry enable|disable enable or disable local capture and delivery`)
}

func runRegister(ctx context.Context, store *Store, args []string, out, errOut io.Writer) int {
	flags := flag.NewFlagSet("register", flag.ContinueOnError)
	flags.SetOutput(errOut)
	inventoryPath := flags.String("inventory", "", "verified inventory JSON")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if strings.TrimSpace(*inventoryPath) == "" {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime register: --inventory is required")
		return 2
	}
	data, err := os.ReadFile(*inventoryPath)
	if err != nil {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime register:", err)
		return 1
	}
	var inventory Inventory
	if err := json.Unmarshal(data, &inventory); err != nil {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime register: invalid inventory JSON:", err)
		return 2
	}
	count, err := store.RegisterInventory(inventory)
	if err != nil {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime register:", err)
		return 1
	}
	_ = ctx
	_ = json.NewEncoder(out).Encode(map[string]any{"registered": count, "origins": len(inventory.Origins)})
	return 0
}

func runHook(ctx context.Context, store *Store, args []string, in io.Reader, out, errOut io.Writer) int {
	flags := flag.NewFlagSet("hook", flag.ContinueOnError)
	flags.SetOutput(errOut)
	agent := flags.String("agent", "", "codex, claude-code, or opencode")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if !validAgents[*agent] {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime hook: --agent must be codex, claude-code, or opencode")
		return 2
	}
	results, err := store.HandleHook(ctx, *agent, in)
	if err != nil {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime hook:", err)
		return 2
	}
	if err := writeHookResult(out, results); err != nil {
		_, _ = fmt.Fprintln(errOut, "skillpack-runtime hook:", err)
		return 1
	}
	return 0
}
