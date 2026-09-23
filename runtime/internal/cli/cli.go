// Package cli owns the native Skillpack management interface. Usage collection remains
// independent: a hook must never need credentials, a network login, or the management store.
package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	usage "github.com/The-Vibe-Company/skillpack/runtime/internal/runtime"
	"io"
	"os"
	"strings"
)

type options struct {
	values map[string]string
	flags  map[string]bool
	args   []string
}

func parseOptions(args []string) (options, error) {
	o := options{values: map[string]string{}, flags: map[string]bool{}}
	boolean := map[string]bool{"public": true, "json": true, "token-stdin": true, "all": true, "dry-run": true, "frozen": true, "force": true, "confirm-secrets": true, "pin": true, "help": true}
	value := map[string]bool{"api-url": true, "profile": true, "input": true, "scope": true, "tools": true, "project": true, "version": true, "output": true, "name": true, "realm": true, "sql": true, "params": true, "manifest": true}
	for i := 0; i < len(args); i++ {
		a := args[i]
		if !strings.HasPrefix(a, "--") {
			o.args = append(o.args, a)
			continue
		}
		key, val, has := strings.Cut(strings.TrimPrefix(a, "--"), "=")
		if boolean[key] {
			if has {
				return o, fmt.Errorf("--%s does not accept a value", key)
			}
			o.flags[key] = true
			continue
		}
		if !value[key] {
			return o, fmt.Errorf("unknown option --%s", key)
		}
		if !has {
			i++
			if i >= len(args) {
				return o, fmt.Errorf("--%s needs a value", key)
			}
			val = args[i]
		}
		o.values[key] = val
	}
	return o, nil
}

type commandError struct {
	code    int
	message string
}

func (e *commandError) Error() string     { return e.message }
func fail(code int, message string) error { return &commandError{code, message} }

type app struct {
	options         options
	in              io.Reader
	out, diagnostic io.Writer
	home            string
}

func Run(args []string, in io.Reader, out, diagnostic io.Writer) int {
	if len(args) == 2 && args[0] == "--internal-native-activate" {
		return activateWorker(args[1])
	}
	if os.Getenv("SKILLPACK_RUNTIME_WORKER") == "1" && len(args) == 3 && args[0] == "--state-dir" && args[2] == "worker" {
		return usage.Run(args, in, out, diagnostic)
	}
	if len(args) > 0 && args[0] == "usage" {
		return usage.Run(args[1:], in, out, diagnostic)
	}
	if len(args) == 1 && (args[0] == "--version" || args[0] == "version") {
		fmt.Fprintln(out, "skillpack "+usage.RuntimeVersion)
		return 0
	}
	o, err := parseOptions(args)
	if err != nil {
		fmt.Fprintln(diagnostic, err)
		return 2
	}
	if len(o.args) == 0 || o.flags["help"] || o.args[0] == "help" {
		fmt.Fprintln(out, "Skillpack native CLI\n\nauth login|status|refresh|logout\nsetup --tools codex,claude-code,opencode\ninstall SLUG [--scope project|user] [--version VERSION]\ninstall --public TOKEN --version VERSION\nupdate SLUG | update --all [--dry-run]\nsync --frozen [--project PATH]\nimport-lock PATH [--project PATH]\nskills list|info|versions|validate|publish\nsecrets list|info|create|update|rotate|delete|configuration|bind|unbind|sync\ndb info|query|execute|shares SKILL\napi METHOD /v1/path [--input FILE|-]\nself update [--version VERSION]\ndoctor --json\nusage hook|sync|doctor|telemetry\n\nUse --json for structured output. Login with hidden input or --token-stdin; never put a key in argv.")
		return 0
	}
	home, err := clientHome()
	if err != nil {
		fmt.Fprintln(diagnostic, "cannot resolve private configuration directory")
		return 1
	}
	a := &app{o, in, out, diagnostic, home}
	var result any
	switch o.args[0] {
	case "auth":
		result, err = a.auth()
	case "skills":
		result, err = a.skills()
	case "api":
		result, err = a.api()
	case "db":
		result, err = a.database()
	case "secrets":
		result, err = a.secrets()
	case "self":
		result, err = a.selfUpdate()
	case "setup":
		result, err = a.setup()
	case "doctor":
		result, err = a.doctor()
	case "update":
		result, err = a.update()
	case "import-lock":
		result, err = a.importLock()
	case "install":
		result, err = a.install()
	case "sync":
		if !o.flags["frozen"] {
			err = fail(2, "use sync --frozen to verify locked packages, or update for new versions")
		} else {
			result, err = a.frozenSync()
		}
	default:
		err = fail(2, "unknown command; run skillpack --help")
	}
	if err != nil {
		if result != nil {
			_ = json.NewEncoder(out).Encode(result)
		}
		code := 1
		var ce *commandError
		if errors.As(err, &ce) {
			code = ce.code
		}
		// Do not include request bodies or credentials in the error envelope.
		if o.flags["json"] {
			json.NewEncoder(diagnostic).Encode(map[string]any{"ok": false, "code": code, "error": err.Error()})
		} else {
			fmt.Fprintln(diagnostic, err)
		}
		return code
	}
	if result != nil {
		if err := json.NewEncoder(out).Encode(result); err != nil {
			return 1
		}
	}
	return 0
}

func (a *app) inputJSON() (json.RawMessage, error) {
	var r io.Reader = a.in
	if p := a.options.values["input"]; p != "" && p != "-" {
		f, err := os.Open(p)
		if err != nil {
			return nil, fail(2, "cannot open input file")
		}
		defer f.Close()
		r = f
	}
	b, err := io.ReadAll(io.LimitReader(r, 8<<20+1))
	if err != nil || len(b) > 8<<20 {
		return nil, fail(5, "invalid or oversized JSON input")
	}
	if !json.Valid(b) {
		return nil, fail(5, "input must be valid JSON")
	}
	return b, nil
}

func (a *app) skills() (any, error) {
	args := a.options.args
	if len(args) < 2 {
		return nil, fail(2, "skills requires list or info")
	}
	if args[1] == "validate" || args[1] == "publish" || args[1] == "push" {
		return a.publishPackage()
	}
	c, err := a.client()
	if err != nil {
		return nil, err
	}
	path := "/skills"
	if args[1] == "info" || args[1] == "versions" {
		if len(args) != 3 || !validSegment(args[2]) {
			return nil, fail(2, "provide a skill slug")
		}
		path += "/" + args[2]
		if args[1] == "versions" {
			path += "/versions"
		}
	}
	if args[1] != "list" && args[1] != "info" && args[1] != "versions" {
		return nil, fail(2, "unknown skills command")
	}
	return c.json("GET", path, nil)
}

func (a *app) api() (any, error) {
	args := a.options.args
	if len(args) != 3 {
		return nil, fail(2, "usage: skillpack api METHOD /v1/path --input -")
	}
	method := strings.ToUpper(args[1])
	path := strings.TrimPrefix(args[2], "/v1")
	if !allowedOperation(method, path) {
		return nil, fail(7, "operation is not exposed by the API-key CLI; use a dedicated command for secret retrieval")
	}
	var body json.RawMessage
	var err error
	if method != "GET" && (method != "DELETE" || a.options.values["input"] != "") {
		body, err = a.inputJSON()
		if err != nil {
			return nil, err
		}
	}
	c, err := a.client()
	if err != nil {
		return nil, err
	}
	return c.json(method, path, body)
}
