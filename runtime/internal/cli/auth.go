package cli

import (
	"encoding/json"
	"fmt"
	"golang.org/x/term"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type profile struct {
	API       string `json:"apiUrl"`
	Key       string `json:"apiKey"`
	Workspace string `json:"workspaceId"`
}
type config struct {
	Version  int                `json:"schemaVersion"`
	Active   string             `json:"activeProfile"`
	Profiles map[string]profile `json:"profiles"`
	Tools    []string           `json:"tools,omitempty"`
}
type keyStatus struct {
	User struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	} `json:"user"`
	Workspace struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"workspace"`
	Token struct {
		ID        string   `json:"id"`
		Prefix    string   `json:"prefix"`
		Scopes    []string `json:"scopes"`
		ExpiresAt string   `json:"expires_at"`
	} `json:"token"`
}

func clientHome() (string, error) {
	if p := os.Getenv("SKILLPACK_HOME"); p != "" {
		return filepath.Abs(p)
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "skillpack"), nil
}
func (a *app) loadConfig() (config, error) {
	c := config{Version: 1, Profiles: map[string]profile{}}
	path := filepath.Join(a.home, "client.json")
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return c, nil
	}
	if err != nil || !info.Mode().IsRegular() {
		return c, fail(3, "client configuration must be a regular private file")
	}
	if err := noSymlinkPath(a.home, path); err != nil {
		return c, fail(3, "refusing symbolic-link client configuration")
	}
	// Copied/restored profiles can inherit permissive modes or ACLs. Restrict
	// both the containing directory and the file before reading any credential.
	if err := protectPath(a.home, true); err != nil {
		return c, fail(3, "cannot restrict configuration directory access")
	}
	if err := protectPath(path, false); err != nil {
		return c, fail(3, "cannot restrict configuration file access")
	}
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return c, nil
	}
	if err != nil {
		return c, fail(3, "cannot read client configuration")
	}
	if json.Unmarshal(b, &c) != nil || c.Version != 1 || c.Profiles == nil {
		return c, fail(3, "client configuration is invalid or newer than this CLI")
	}
	return c, nil
}
func (a *app) saveConfig(c config) error {
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return writePrivate(filepath.Join(a.home, "client.json"), append(b, '\n'))
}
func (a *app) client() (*client, error) {
	cfg, err := a.loadConfig()
	if err != nil {
		return nil, err
	}
	name := a.options.values["profile"]
	if name == "" {
		name = cfg.Active
	}
	p := cfg.Profiles[name]
	base := a.options.values["api-url"]
	if base == "" {
		base = os.Getenv("SKILLPACK_API_URL")
	}
	if base == "" && os.Getenv("SKILLPACK_API_KEY") == "" {
		base = p.API
	}
	if base == "" {
		base = "https://skillpack.app/v1"
	}
	key := os.Getenv("SKILLPACK_API_KEY")
	if key == "" {
		key = p.Key
		if base != "" && p.API != "" {
			normalized, err := normalizeAPI(base)
			if err != nil {
				return nil, err
			}
			if normalized != p.API {
				return nil, fail(3, "API origin differs from saved key; choose the matching profile")
			}
		}
	}
	if key == "" {
		return nil, fail(3, "no API key; use auth login or SKILLPACK_API_KEY")
	}
	return newClient(base, key)
}
func (c *client) status() (keyStatus, error) {
	var status keyStatus
	b, err := c.request("GET", "/tokens/current", nil, "", 1<<20)
	if err != nil {
		return status, err
	}
	if json.Unmarshal(b, &status) != nil || status.Workspace.ID == "" || status.User.ID == "" || status.Token.ID == "" {
		return status, fail(8, "server lacks compatible API-key status; update the server first")
	}
	return status, nil
}
func (a *app) auth() (any, error) {
	args := a.options.args
	if len(args) != 2 {
		return nil, fail(2, "auth requires login, status, refresh or logout")
	}
	if args[1] != "status" {
		if info, err := os.Lstat(a.home); err == nil && info.Mode()&os.ModeSymlink != 0 {
			return nil, fail(3, "refusing symbolic-link configuration directory")
		}
		if err := os.MkdirAll(a.home, 0700); err != nil {
			return nil, fail(3, "cannot create private configuration directory")
		}
		if err := protectPath(a.home, true); err != nil {
			return nil, fail(3, "cannot restrict configuration access")
		}
		unlock, err := acquireLock(filepath.Join(a.home, ".client.lock"))
		if err != nil {
			return nil, err
		}
		defer unlock()
	}
	switch args[1] {
	case "login":
		base := a.options.values["api-url"]
		if base == "" {
			base = os.Getenv("SKILLPACK_API_URL")
		}
		if base == "" {
			base = "https://skillpack.app/v1"
		}
		var key []byte
		var err error
		if !a.options.flags["token-stdin"] && !a.options.flags["manual"] {
			var browserKey string
			browserKey, err = a.browserLogin(base)
			key = []byte(browserKey)
		} else if a.options.flags["token-stdin"] {
			key, err = io.ReadAll(io.LimitReader(a.in, 4097))
			if len(key) > 4096 {
				return nil, fail(3, "invalid API key length")
			}
		} else {
			f, ok := a.in.(*os.File)
			if !ok || !term.IsTerminal(int(f.Fd())) {
				return nil, fail(2, "use --token-stdin in a non-interactive session")
			}
			fmt.Fprint(a.diagnostic, "API key: ")
			key, err = term.ReadPassword(int(f.Fd()))
			fmt.Fprintln(a.diagnostic)
		}
		if err != nil {
			return nil, err
		}
		c, err := newClient(base, strings.TrimSpace(string(key)))
		if err != nil {
			return nil, err
		}
		status, err := c.status()
		if err != nil {
			return nil, err
		}
		cfg, err := a.loadConfig()
		if err != nil {
			return nil, err
		}
		name := a.options.values["profile"]
		if name == "" {
			name = "default"
		}
		cfg.Profiles[name] = profile{c.base, c.key, status.Workspace.ID}
		cfg.Active = name
		if err = a.saveConfig(cfg); err != nil {
			return nil, fail(3, "could not persist API key privately")
		}
		return status, nil
	case "status":
		c, err := a.client()
		if err != nil {
			return nil, err
		}
		return c.status()
	case "logout":
		cfg, err := a.loadConfig()
		if err != nil {
			return nil, err
		}
		name := a.options.values["profile"]
		if name == "" {
			name = cfg.Active
		}
		delete(cfg.Profiles, name)
		if cfg.Active == name {
			cfg.Active = ""
		}
		if err = a.saveConfig(cfg); err != nil {
			return nil, fail(3, "could not clear saved key")
		}
		return map[string]any{"ok": true, "revoked": false, "environmentKeyPresent": os.Getenv("SKILLPACK_API_KEY") != ""}, nil
	case "refresh":
		if os.Getenv("SKILLPACK_API_KEY") != "" {
			return nil, fail(3, "environment keys are externally managed; rotate through the credential owner")
		}
		c, err := a.client()
		if err != nil {
			return nil, err
		}
		cfg, err := a.loadConfig()
		if err != nil {
			return nil, err
		}
		b, err := c.request("POST", "/tokens/refresh", []byte(`{}`), "application/json", 1<<20)
		if err != nil {
			return nil, err
		}
		var r struct {
			Status  string `json:"status"`
			Token   string `json:"token"`
			Expires string `json:"expires_at"`
		}
		if json.Unmarshal(b, &r) != nil {
			return nil, fail(8, "refresh result unreadable; reconnect before retrying")
		}
		if r.Status == "rotated" {
			if !strings.HasPrefix(r.Token, "cmp_pat_") {
				return nil, fail(8, "invalid refresh result")
			}
			name := a.options.values["profile"]
			if name == "" {
				name = cfg.Active
			}
			p := cfg.Profiles[name]
			p.Key = r.Token
			cfg.Profiles[name] = p
			if a.saveConfig(cfg) != nil {
				return nil, fail(3, "rotated key could not be saved; reconnect")
			}
		}
		return map[string]any{"status": r.Status, "expires_at": r.Expires}, nil
	default:
		return nil, fail(2, "unknown auth command")
	}
}

func writePrivate(path string, b []byte) error {
	parent := filepath.Dir(path)
	if info, err := os.Lstat(parent); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return fail(3, "refusing symbolic-link configuration directory")
	}
	if err := os.MkdirAll(parent, 0700); err != nil {
		return err
	}
	if err := protectPath(parent, true); err != nil {
		return err
	}
	if info, err := os.Lstat(path); err == nil && !info.Mode().IsRegular() {
		return fail(3, "refusing non-regular private file")
	}
	f, err := os.CreateTemp(parent, ".skillpack-")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err := protectPath(name, false); err != nil {
		f.Close()
		return err
	}
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := replaceFile(name, path); err != nil {
		return err
	}
	syncDir(parent)
	return nil
}
