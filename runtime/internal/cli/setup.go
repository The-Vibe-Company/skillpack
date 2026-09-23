package cli

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	usage "github.com/The-Vibe-Company/skillpack/runtime/internal/runtime"
	"github.com/google/uuid"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
	"unicode/utf16"
)

//go:embed contracts/opencode-runtime.mjs
var openCodeBridge []byte

func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'" }
func powershellCommand(args []string) string {
	parts := []string{}
	for _, arg := range args {
		parts = append(parts, "'"+strings.ReplaceAll(arg, "'", "''")+"'")
	}
	script := "& " + strings.Join(parts, " ")
	words := utf16.Encode([]rune(script))
	b := make([]byte, len(words)*2)
	for i, v := range words {
		b[2*i] = byte(v)
		b[2*i+1] = byte(v >> 8)
	}
	return "powershell.exe -NoProfile -NonInteractive -EncodedCommand " + base64.StdEncoding.EncodeToString(b)
}
func hookDocument(path string, args []string, agent string) ([]byte, error) {
	current := map[string]any{}
	b, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil && (json.Unmarshal(b, &current) != nil || current == nil) {
		return nil, fail(6, "host hook configuration is invalid; preserved")
	}
	hooks, ok := current["hooks"].(map[string]any)
	if !ok {
		if _, exists := current["hooks"]; exists {
			return nil, fail(6, "host hooks must be an object")
		}
		hooks = map[string]any{}
		current["hooks"] = hooks
	}
	events := []string{"SessionStart", "UserPromptSubmit", "PostToolUse", "SubagentStart", "Stop"}
	if agent == "claude-code" {
		events = append(events, "UserPromptExpansion", "PostToolUseFailure")
	}
	quoted := []string{}
	for _, arg := range args {
		quoted = append(quoted, shellQuote(arg))
	}
	command := strings.Join(quoted, " ")
	win := powershellCommand(args)
	if runtime.GOOS == "windows" {
		command = win
	}
	for _, event := range events {
		groups := []any{}
		if old, exists := hooks[event]; exists {
			var ok bool
			groups, ok = old.([]any)
			if !ok {
				return nil, fail(6, "host hook event must be an array")
			}
		}
		retained := []any{}
		for _, raw := range groups {
			group, ok := raw.(map[string]any)
			if !ok {
				return nil, fail(6, "invalid hook matcher group")
			}
			handlers, ok := group["hooks"].([]any)
			if !ok {
				return nil, fail(6, "invalid hook handlers")
			}
			kept := []any{}
			for _, raw := range handlers {
				handler, ok := raw.(map[string]any)
				if !ok {
					return nil, fail(6, "invalid hook handler")
				}
				if handler["statusMessage"] != "Skillpack runtime" {
					kept = append(kept, handler)
				}
			}
			if len(kept) > 0 {
				group["hooks"] = kept
				retained = append(retained, group)
			}
		}
		handler := map[string]any{"type": "command", "command": command, "timeout": 3, "statusMessage": "Skillpack runtime"}
		if agent == "codex" {
			handler["commandWindows"] = win
		}
		retained = append(retained, map[string]any{"hooks": []any{handler}})
		hooks[event] = retained
	}
	return json.MarshalIndent(current, "", "  ")
}
func (a *app) setup() (any, error) {
	tools, err := a.tools()
	if err != nil {
		return nil, err
	}
	if _, err = secureSubdir(a.home); err != nil {
		return nil, err
	}
	unlock, err := acquireLock(filepath.Join(a.home, ".mutation.lock"))
	if err != nil {
		return nil, err
	}
	defer unlock()
	if err = a.recoverTransaction(); err != nil {
		return nil, err
	}
	store, err := usage.OpenStore("")
	if err != nil {
		return nil, err
	}
	defer store.Close()
	state := store.StateDir()
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return nil, err
	}
	hookExe := exe
	var installed struct {
		Executable string `json:"executablePath"`
	}
	if body, e := os.ReadFile(filepath.Join(a.home, "cli", "install.json")); e == nil && json.Unmarshal(body, &installed) == nil && filepath.IsAbs(installed.Executable) {
		if actual, e := filepath.EvalSymlinks(installed.Executable); e == nil && actual == exe {
			hookExe = installed.Executable
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	configured := map[string]bool{}
	statuses := map[string]string{}
	var replacements []replacement
	defer a.discardUncommitted(&replacements)
	for _, tool := range tools {
		var location string
		switch tool {
		case "codex":
			root := os.Getenv("CODEX_HOME")
			if root == "" {
				root = filepath.Join(home, ".codex")
			}
			location = filepath.Join(root, "hooks.json")
		case "claude-code":
			root := os.Getenv("CLAUDE_CONFIG_DIR")
			if root == "" {
				root = filepath.Join(home, ".claude")
			}
			location = filepath.Join(root, "settings.json")
		case "opencode":
			rows, err := a.stageOpenCode(exe, state)
			if err != nil {
				return nil, err
			}
			replacements = append(replacements, rows...)
			configured[tool] = true
			statuses[tool] = "configured_awaiting_observation"
			continue
		default:
			return nil, fail(2, "usage setup supports codex, claude-code and opencode")
		}
		if err = noSymlinkPath(filepath.Dir(location), location); err != nil {
			return nil, err
		}
		body, err := hookDocument(location, []string{hookExe, "usage", "--state-dir", state, "hook", "--agent", tool}, tool)
		if err != nil {
			return nil, err
		}
		r, err := stageFile(location, body, true)
		if err != nil {
			return nil, err
		}
		replacements = append(replacements, r)
		configured[tool] = true
		statuses[tool] = "configured_awaiting_observation"
		if tool == "codex" {
			statuses[tool] = "requires_host_approval"
		}
	}
	marker := filepath.Join(state, "hook-setup.json")
	existing := struct {
		Agents map[string]bool `json:"agents"`
	}{Agents: map[string]bool{}}
	if b, err := os.ReadFile(marker); err == nil {
		if json.Unmarshal(b, &existing) != nil {
			return nil, fail(6, "invalid hook setup receipt")
		}
	}
	for k, v := range configured {
		existing.Agents[k] = v
	}
	body, _ := json.Marshal(map[string]any{"schemaVersion": 1, "agents": existing.Agents, "updatedAt": time.Now().UTC().Format(time.RFC3339)})
	r, err := stageFile(marker, body, true)
	if err != nil {
		return nil, err
	}
	replacements = append(replacements, r)
	if !a.options.flags["dry-run"] {
		if err = a.commitTransaction(replacements); err != nil {
			return nil, err
		}
	}
	if a.options.flags["dry-run"] {
		return map[string]any{"dryRun": true, "hooks": statuses}, nil
	}
	unlockConfig, err := acquireLock(filepath.Join(a.home, ".client.lock"))
	if err != nil {
		return nil, err
	}
	defer unlockConfig()
	cfg, err := a.loadConfig()
	if err != nil {
		return nil, err
	}
	cfg.Tools = tools
	if err = a.saveConfig(cfg); err != nil {
		return nil, err
	}
	registered, err := a.registerInventory(store)
	if err != nil {
		return nil, err
	}
	return map[string]any{"hooks": statuses, "registeredSkills": registered, "codexTrust": "Review new hooks in /hooks; setup does not approve them."}, nil
}
func (a *app) stageOpenCode(exe, state string) ([]replacement, error) {
	root := os.Getenv("OPENCODE_CONFIG_DIR")
	if root == "" {
		root = os.Getenv("XDG_CONFIG_HOME")
		if root == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return nil, err
			}
			root = filepath.Join(home, ".config")
		}
		root = filepath.Join(root, "opencode")
	}
	destination := filepath.Join(root, "plugins", "skillpack-runtime.js")
	receipt := filepath.Join(root, ".skillpack-runtime-install.json")
	if err := noSymlinkPath(root, destination); err != nil {
		return nil, err
	}
	hash := sha256.Sum256(openCodeBridge)
	expected := hex.EncodeToString(hash[:])
	if old, err := os.ReadFile(destination); err == nil {
		actual := sha256.Sum256(old)
		oldHash := hex.EncodeToString(actual[:])
		var previous struct {
			Hash string `json:"sha256"`
		}
		b, _ := os.ReadFile(receipt)
		_ = json.Unmarshal(b, &previous)
		if oldHash != expected && oldHash != previous.Hash {
			return nil, fail(9, "customized OpenCode plugin preserved")
		}
	}
	binary := "skillpack-runtime"
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	source := filepath.Join(filepath.Dir(exe), binary)
	if runtime.GOOS == "windows" {
		var receipt struct {
			Runtime string `json:"runtimeExecutablePath"`
		}
		if b, e := os.ReadFile(filepath.Join(a.home, "cli", "install.json")); e == nil && json.Unmarshal(b, &receipt) == nil {
			root := filepath.Join(a.home, "cli", "versions")
			if e = noSymlinkPath(root, receipt.Runtime); e != nil {
				return nil, e
			}
			source = receipt.Runtime
		}
	}
	info, err := os.Lstat(source)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 128<<20 {
		return nil, fail(4, "native runtime companion missing beside CLI; reinstall the official archive")
	}
	body, err := os.ReadFile(source)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(body)
	// Keep the bridge contract compatible with the already installed host plugin.
	target := filepath.Join(state, "versions", usage.RuntimeVersion+"-native", binary)
	if err = noSymlinkPath(state, target); err != nil {
		return nil, err
	}
	rows := []replacement{}
	success := false
	defer func() {
		if !success {
			a.discardUncommitted(&rows)
		}
	}()
	r, err := stageFile(target, body, false)
	if err != nil {
		return nil, err
	}
	if err = os.Chmod(r.Stage, 0755); err != nil {
		os.Remove(r.Stage)
		return nil, err
	}
	r.Root = state
	rows = append(rows, r)
	relative, _ := filepath.Rel(state, target)
	active, _ := json.Marshal(map[string]any{"version": usage.RuntimeVersion, "binary": filepath.ToSlash(relative), "binarySha256": hex.EncodeToString(digest[:])})
	metadata, _ := json.Marshal(map[string]any{"schemaVersion": 1, "destination": "plugins/skillpack-runtime.js", "sha256": expected})
	for path, body := range map[string][]byte{filepath.Join(state, "active.json"): active, destination: openCodeBridge, receipt: metadata} {
		r, err = stageFile(path, body, true)
		if err != nil {
			return nil, err
		}
		rows = append(rows, r)
	}
	success = true
	return rows, nil
}
func (a *app) registerInventory(store *usage.Store) (int, error) {
	home, err := legacyHome()
	if err != nil {
		return 0, err
	}
	project, err := projectRoot(a.options.values["project"])
	if err != nil {
		return 0, err
	}
	inv := usage.Inventory{SchemaVersion: 1, Origins: []string{}, Skills: []usage.InventorySkill{}}
	seen := map[string]bool{}
	for _, path := range []string{filepath.Join(home, "skills.lock.json"), filepath.Join(project, ".companion", "skills.lock.json")} {
		lock, err := readLock(path)
		if err != nil {
			return 0, err
		}
		for _, workspace := range lock.Workspaces {
			origin := strings.TrimSuffix(workspace.API, "/v1")
			if !strings.HasPrefix(origin, "https://") {
				continue
			}
			if !seen[origin] {
				inv.Origins = append(inv.Origins, origin)
				seen[origin] = true
			}
			for slug, skill := range workspace.Skills {
				id := skill.ID
				if id == "" {
					_ = json.Unmarshal(skill.Extra["companionSkillId"], &id)
				}
				if _, err := uuid.Parse(id); err != nil {
					continue
				}
				for _, target := range skill.Targets {
					destination, err := targetPath(target, slug, project)
					if err != nil {
						continue
					}
					pkg, dir, err := currentPackage(destination)
					if err != nil {
						continue
					}
					if target.Checksum != "" && dir != target.Checksum || target.PackageChecksum != "" && pkg != target.PackageChecksum {
						continue
					}
					if target.Checksum == "" && target.PackageChecksum == "" || seen[destination] {
						continue
					}
					seen[destination] = true
					version := target.Version
					if version == "" {
						version = skill.Version
					}
					inv.Skills = append(inv.Skills, usage.InventorySkill{Path: destination, SkillID: id, Version: version, Origin: origin})
				}
			}
		}
	}
	// Repository inventories from the previous runtime bootstrap remain usable.
	inventoryPath := filepath.Join(project, ".agents", "skillpack", "usage", "inventory.json")
	if b, e := os.ReadFile(inventoryPath); e == nil {
		var legacy struct {
			Schema  int      `json:"schemaVersion"`
			Origins []string `json:"origins"`
			Skills  []struct {
				Path    string            `json:"path"`
				ID      string            `json:"skillId"`
				Version string            `json:"version"`
				Origin  string            `json:"origin"`
				Files   map[string]string `json:"files"`
			} `json:"skills"`
		}
		if json.Unmarshal(b, &legacy) != nil || legacy.Schema != 1 {
			return 0, fail(5, "repository usage inventory invalid")
		}
		trusted := map[string]bool{}
		for _, origin := range legacy.Origins {
			base, e := normalizeAPI(origin)
			if e == nil && strings.HasPrefix(base, "https://") {
				trusted[strings.TrimSuffix(base, "/v1")] = true
			}
		}
		for _, row := range legacy.Skills {
			if !trusted[row.Origin] || filepath.IsAbs(row.Path) || len(row.Files) == 0 {
				continue
			}
			destination := filepath.Join(project, filepath.FromSlash(row.Path))
			if noSymlinkPath(project, destination) != nil || seen[destination] {
				continue
			}
			files, e := scanPackage(destination)
			if e != nil || len(files) != len(row.Files) {
				continue
			}
			verified := true
			for name, hash := range row.Files {
				if digestBytes(files[name]) != hash {
					verified = false
					break
				}
			}
			if !verified {
				continue
			}
			if _, e := uuid.Parse(row.ID); e != nil {
				continue
			}
			inv.Skills = append(inv.Skills, usage.InventorySkill{Path: destination, SkillID: row.ID, Version: row.Version, Origin: row.Origin})
			seen[destination] = true
			if !seen[row.Origin] {
				inv.Origins = append(inv.Origins, row.Origin)
				seen[row.Origin] = true
			}
		}
	}
	if len(inv.Origins) == 0 {
		return 0, nil
	}
	return store.RegisterInventory(inv)
}
func (a *app) doctor() (any, error) {
	store, err := usage.OpenStore("")
	if err != nil {
		return nil, err
	}
	defer store.Close()
	runtimeStatus, err := store.Doctor(context.Background())
	if err != nil {
		return nil, err
	}
	result := map[string]any{"usage": runtimeStatus, "credentials": "not_configured", "runtimePrerequisites": "not_verified"}
	c, err := a.client()
	if err == nil {
		status, err := c.status()
		if err == nil {
			result["credentials"] = "valid"
			result["workspace"] = status.Workspace.ID
		} else {
			result["credentials"] = "unavailable"
		}
	}
	project, err := projectRoot(a.options.values["project"])
	if err != nil {
		return nil, err
	}
	home, err := legacyHome()
	if err != nil {
		return nil, err
	}
	packages := []map[string]any{}
	seenLocks := map[string]bool{}
	for _, lockPath := range []string{filepath.Join(home, "skills.lock.json"), filepath.Join(project, ".companion", "skills.lock.json")} {
		if seenLocks[lockPath] {
			continue
		}
		seenLocks[lockPath] = true
		lock, err := readLock(lockPath)
		if err != nil {
			return nil, err
		}
		for workspaceID, workspace := range lock.Workspaces {
			for slug, skill := range workspace.Skills {
				for _, target := range skill.Targets {
					status := "verified"
					destination, err := targetPath(target, slug, project)
					if err != nil {
						status = "invalid_path"
					} else {
						hash, folder, err := currentPackage(destination)
						expected := target.PackageChecksum
						if expected == "" {
							expected = skill.Checksum
						}
						if err != nil {
							status = "missing"
						} else if hash != expected || target.Checksum != "" && folder != target.Checksum {
							status = "modified"
						}
					}
					prerequisites := map[string]any{"status": "not_verified"}
					if status == "verified" {
						prerequisites = localPrerequisites(destination, home, workspaceID, slug)
					}
					if prerequisites["status"] == "missing_local_secrets" {
						result["runtimePrerequisites"] = "missing_local_secrets"
					}
					packages = append(packages, map[string]any{"workspace": workspaceID, "scope": target.Scope, "slug": slug, "path": target.Path, "status": status, "runtimePrerequisites": prerequisites})
				}
			}
		}
	}
	result["packages"] = packages
	if _, e := os.Stat(filepath.Join(a.home, "cli", "activation.json")); e == nil {
		result["binaryUpdate"] = "activation_pending"
	}
	if _, e := os.Stat(filepath.Join(a.home, "cli", "activation-error.json")); e == nil {
		result["binaryUpdate"] = "activation_failed_close_other_processes_and_retry"
	}
	return result, nil
}

// Local inspection never redeems a grant or claims that a remote database works.
// Only declared key names, never their values, are returned to the caller.
func localPrerequisites(destination, home, workspace, slug string) map[string]any {
	result := map[string]any{"status": "not_verified", "database": "not_declared", "missingSecrets": []string{}}
	body, err := os.ReadFile(filepath.Join(destination, "companion.json"))
	if err != nil {
		return result
	}
	var manifest struct {
		Environment struct {
			Secrets map[string]struct {
				Required bool `json:"required"`
			} `json:"secrets"`
		} `json:"environment"`
		Database struct {
			Tables map[string]json.RawMessage `json:"tables"`
		} `json:"database"`
	}
	if json.Unmarshal(body, &manifest) != nil {
		return result
	}
	if len(manifest.Database.Tables) > 0 {
		result["database"] = "not_verified"
	}
	present := map[string]bool{}
	projection := filepath.Join(home, "secrets", workspace, slug, ".env")
	info, statErr := os.Lstat(projection)
	if validSegment(workspace) && validSegment(slug) && noSymlinkPath(home, projection) == nil && statErr == nil && info.Mode().IsRegular() && info.Size() <= 1<<20 {
		if file, e := os.Open(projection); e == nil {
			data, e := io.ReadAll(io.LimitReader(file, 1<<20))
			file.Close()
			if e == nil {
				for _, line := range strings.Split(string(data), "\n") {
					key, _, ok := strings.Cut(strings.TrimSpace(line), "=")
					if ok {
						present[strings.TrimSpace(strings.TrimPrefix(key, "export "))] = true
					}
				}
			}
		}
	}
	missing := []string{}
	for key, slot := range manifest.Environment.Secrets {
		if slot.Required && os.Getenv(key) == "" && !present[key] {
			missing = append(missing, key)
		}
	}
	sort.Strings(missing)
	result["missingSecrets"] = missing
	if len(missing) > 0 {
		result["status"] = "missing_local_secrets"
	}
	return result
}
