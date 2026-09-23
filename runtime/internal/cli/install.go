package cli

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	usage "github.com/The-Vibe-Company/skillpack/runtime/internal/runtime"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed contracts/tools.json
var toolRegistry []byte

type installedTarget struct {
	Extra           map[string]json.RawMessage `json:"-"`
	Tool            string                     `json:"tool"`
	Scope           string                     `json:"scope"`
	Path            string                     `json:"path"`
	Checksum        string                     `json:"checksum"`
	PackageChecksum string                     `json:"packageChecksum"`
	Version         string                     `json:"version"`
}
type installedSkill struct {
	Extra    map[string]json.RawMessage `json:"-"`
	Name     string                     `json:"name"`
	Slug     string                     `json:"slug"`
	ID       string                     `json:"skillId"`
	Version  string                     `json:"version"`
	Checksum string                     `json:"checksum"`
	Targets  []installedTarget          `json:"targets"`
	Pinned   any                        `json:"pinned"`
	Added    string                     `json:"addedAt,omitempty"`
}
type workspaceLock struct {
	Extra  map[string]json.RawMessage `json:"-"`
	API    string                     `json:"apiUrl"`
	Skills map[string]installedSkill  `json:"skills"`
}
type installLock struct {
	Extra      map[string]json.RawMessage `json:"-"`
	Version    int                        `json:"lockfileVersion"`
	Workspaces map[string]workspaceLock   `json:"workspaces"`
}
type installNode struct {
	Slug, ID, Version, Checksum string
	Files                       map[string][]byte
	Local                       bool
	Pinned                      any
}

func projectRoot(selected string) (string, error) {
	if selected != "" {
		return filepath.Abs(selected)
	}
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	start := dir
	for {
		if _, err = os.Stat(filepath.Join(dir, ".git")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return start, nil
		}
		dir = parent
	}
}
func readLock(path string) (installLock, error) {
	l := installLock{Version: 2, Workspaces: map[string]workspaceLock{}}
	if info, err := os.Lstat(path); err == nil && !info.Mode().IsRegular() {
		return l, fail(6, "lockfile is redirected")
	}
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return l, nil
	}
	if err != nil {
		return l, err
	}
	if json.Unmarshal(b, &l) != nil || l.Version != 2 || l.Workspaces == nil {
		return l, fail(6, "unsupported or invalid skills lockfile; import the legacy export explicitly")
	}
	return l, nil
}
func (a *app) tools() ([]string, error) {
	if raw := a.options.values["tools"]; raw != "" {
		return strings.Split(raw, ","), nil
	}
	cfg, err := a.loadConfig()
	if err != nil {
		return nil, err
	}
	if len(cfg.Tools) > 0 {
		return cfg.Tools, nil
	}
	home, err := legacyHome()
	if err != nil {
		return nil, err
	}
	if b, err := os.ReadFile(filepath.Join(home, "config.json")); err == nil {
		var v struct {
			Tools []string `json:"tools"`
		}
		if json.Unmarshal(b, &v) == nil && len(v.Tools) > 0 {
			return v.Tools, nil
		}
	}
	return []string{"codex", "claude-code", "opencode"}, nil
}
func toolRoot(tool, scope, project string) (string, error) {
	if tool == "shared" && scope == "project" {
		return filepath.Join(project, ".agents", "skills"), nil
	}
	var registry struct {
		Tools map[string]struct {
			Dirs map[string]string `json:"skillsDir"`
		} `json:"tools"`
	}
	if json.Unmarshal(toolRegistry, &registry) != nil {
		return "", fail(5, "invalid tools registry")
	}
	t, ok := registry.Tools[tool]
	if !ok {
		return "", fail(2, "unknown coding tool")
	}
	path := t.Dirs[scope]
	if path == "" {
		return "", fail(2, "tool does not support requested scope")
	}
	if strings.Contains(path, "${AGENT_STATE_DIR:-~/.companions}") {
		base := os.Getenv("AGENT_STATE_DIR")
		if base == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			base = filepath.Join(home, ".companions")
		}
		path = strings.ReplaceAll(path, "${AGENT_STATE_DIR:-~/.companions}", base)
	}
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		path = filepath.Join(home, path[2:])
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(project, path)
	}
	return filepath.Clean(path), nil
}
func targetPath(t installedTarget, slug, project string) (string, error) {
	root, err := toolRoot(t.Tool, t.Scope, project)
	if err != nil {
		return "", err
	}
	expected := filepath.Join(root, slug)
	path := t.Path
	if !filepath.IsAbs(path) {
		path = filepath.Join(project, filepath.FromSlash(path))
	}
	if filepath.Clean(path) != expected {
		return "", fail(6, "lockfile destination differs from the tool's managed skill path")
	}
	if t.Scope == "project" {
		root = project
	}
	if err = noSymlinkPath(root, path); err != nil {
		return "", err
	}
	return path, nil
}
func folderChecksum(files map[string][]byte) string {
	names := make([]string, 0, len(files))
	for p := range files {
		names = append(names, p)
	}
	sort.Strings(names)
	h := sha256.New()
	for _, p := range names {
		h.Write([]byte(p))
		h.Write([]byte{0})
		h.Write(files[p])
		h.Write([]byte{0})
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil))
}
func currentPackage(path string) (string, string, error) {
	files, err := scanPackage(path)
	if err != nil {
		return "", "", err
	}
	_, pkg, err := canonicalPackage(files)
	if err != nil {
		return "", "", err
	}
	var paths []string
	err = filepath.WalkDir(path, func(p string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fail(9, "local skill contains a symbolic link")
		}
		if !d.IsDir() {
			paths = append(paths, p)
		}
		return nil
	})
	if err != nil {
		return "", "", err
	}
	sort.Strings(paths)
	h := sha256.New()
	for _, p := range paths {
		rel, _ := filepath.Rel(path, p)
		h.Write([]byte(filepath.ToSlash(rel)))
		h.Write([]byte{0})
		f, e := os.Open(p)
		if e != nil {
			return "", "", e
		}
		info, e := f.Stat()
		if e != nil || !info.Mode().IsRegular() {
			f.Close()
			return "", "", fail(9, "local skill contains a special file")
		}
		_, e = io.Copy(h, f)
		f.Close()
		if e != nil {
			return "", "", e
		}
		h.Write([]byte{0})
	}
	return pkg, "sha256:" + hex.EncodeToString(h.Sum(nil)), nil
}

func (c *client) installPlan(root, version string, existing workspaceLock) ([]installNode, error) {
	var nodes []installNode
	visited := map[string]bool{}
	visiting := map[string]bool{}
	var visit func(string, string) error
	visit = func(slug, selected string) error {
		if !skillName.MatchString(slug) {
			return fail(2, "invalid skill slug")
		}
		if visiting[slug] {
			return fail(5, "dependency cycle")
		}
		if visited[slug] {
			return nil
		}
		if len(visited)+len(visiting) >= 64 {
			return fail(5, "dependency closure exceeds 64 skills")
		}
		visiting[slug] = true
		n := installNode{Slug: slug, Pinned: nil}
		if selected == "" {
			if old, ok := existing.Skills[slug]; ok && old.Pinned != nil && old.Pinned != false && old.Pinned != "" {
				selected = old.Version
				n.Pinned = old.Pinned
			}
		}
		if slug == "skillpack" {
			b, err := c.request("GET", "/local-skills/skillpack", nil, "", 8<<20)
			if err != nil {
				return err
			}
			var row struct {
				Version   string `json:"availableVersion"`
				Integrity struct {
					Checksum string `json:"packageChecksum"`
				} `json:"integrity"`
			}
			if json.Unmarshal(b, &row) != nil || row.Version == "" {
				return fail(8, "invalid management skill metadata")
			}
			if selected != "" && selected != row.Version {
				return fail(6, "server only serves its current management skill bundle")
			}
			n.Version = row.Version
			n.Checksum = row.Integrity.Checksum
			n.Local = true
		} else {
			b, err := c.request("GET", "/skills/"+slug, nil, "", 8<<20)
			if err != nil {
				return err
			}
			var row struct {
				ID       string `json:"id"`
				Slug     string `json:"slug"`
				Version  string `json:"current_version"`
				Checksum string `json:"checksum"`
			}
			if json.Unmarshal(b, &row) != nil || row.Slug != slug || row.ID == "" || row.Version == "" {
				return fail(8, "invalid skill metadata")
			}
			n.ID = row.ID
			n.Version = row.Version
			n.Checksum = row.Checksum
			if selected != "" && selected != n.Version {
				b, err = c.request("GET", "/skills/"+slug+"/versions", nil, "", 8<<20)
				if err != nil {
					return err
				}
				var versions []struct {
					Version  string `json:"version"`
					Checksum string `json:"checksum"`
				}
				if json.Unmarshal(b, &versions) != nil {
					return fail(8, "invalid version metadata")
				}
				found := false
				for _, v := range versions {
					if v.Version == selected {
						n.Version = v.Version
						n.Checksum = v.Checksum
						found = true
					}
				}
				if !found {
					return fail(4, "pinned version unavailable")
				}
			}
			if !validSegment(n.Version) {
				return fail(8, "invalid published version")
			}
			b, err = c.request("GET", "/skills/"+slug+"/dependencies?version="+n.Version, nil, "", 8<<20)
			if err != nil {
				return err
			}
			var deps struct {
				Requires []struct {
					Slug, Status string
					CanOpen      bool `json:"can_open"`
				} `json:"requires"`
			}
			if json.Unmarshal(b, &deps) != nil {
				return fail(8, "invalid dependencies response")
			}
			for _, d := range deps.Requires {
				if d.Status != "satisfied" || !d.CanOpen {
					return fail(5, "dependency is missing or inaccessible")
				}
				if err = visit(d.Slug, ""); err != nil {
					return err
				}
			}
		}
		if !strings.HasPrefix(n.Checksum, "sha256:") || len(n.Checksum) != 71 {
			return fail(8, "missing immutable package checksum")
		}
		delete(visiting, slug)
		visited[slug] = true
		nodes = append(nodes, n)
		return nil
	}
	if err := visit(root, version); err != nil {
		return nil, err
	}
	return nodes, nil
}
func (c *client) downloadNode(n *installNode) error {
	path := "/skills/" + n.Slug + "/versions/" + n.Version + "/package"
	if n.Local {
		path = "/local-skills/skillpack/package"
	}
	b, err := c.request("GET", path, nil, "", maxPackageBytes*2)
	if err != nil {
		return err
	}
	files, err := readPackage(b)
	if err != nil {
		return err
	}
	_, hash, err := canonicalPackage(files)
	if err != nil {
		return err
	}
	if hash != n.Checksum {
		return fail(5, "package checksum differs from immutable metadata")
	}
	name, err := validatePackageKind(files, n.Local)
	if err != nil {
		return err
	}
	if name != n.Slug {
		return fail(5, "package name differs from selected skill")
	}
	n.Files = files
	return nil
}

func (a *app) install() (any, error) {
	args := a.options.args
	if len(args) != 2 {
		return nil, fail(2, "install requires a skill slug")
	}
	rootSlug := args[1]
	scope := a.options.values["scope"]
	if scope == "" {
		scope = "user"
	}
	if scope != "user" && scope != "project" {
		return nil, fail(2, "scope must be user or project")
	}
	project, err := projectRoot(a.options.values["project"])
	if err != nil {
		return nil, err
	}
	home, err := legacyHome()
	if err != nil {
		return nil, err
	}
	lockRoot := home
	if scope == "project" {
		lockRoot = filepath.Join(project, ".companion")
	}
	if scope == "project" {
		if err = noSymlinkPath(project, lockRoot); err != nil {
			return nil, err
		}
	} else {
		if _, err = secureSubdir(home); err != nil {
			return nil, err
		}
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
	lockPath := filepath.Join(lockRoot, "skills.lock.json")
	unlockScope, err := acquireLock(lockPath + ".lock")
	if err != nil {
		return nil, err
	}
	defer unlockScope()
	lock, err := readLock(lockPath)
	if err != nil {
		return nil, err
	}
	c, err := a.client()
	if err != nil {
		return nil, err
	}
	status, err := c.status()
	if err != nil {
		return nil, err
	}
	workspace := status.Workspace.ID
	entry := lock.Workspaces[workspace]
	if entry.API != "" && entry.API != c.base {
		return nil, fail(6, "lockfile organization belongs to another API instance")
	}
	entry.API = c.base
	if entry.Skills == nil {
		entry.Skills = map[string]installedSkill{}
	}
	var nodes []installNode
	if a.options.flags["public"] {
		var node installNode
		node, err = c.publicNode(rootSlug, a.options.values["version"])
		nodes = []installNode{node}
		rootSlug = node.Slug
	} else {
		nodes, err = c.installPlan(rootSlug, a.options.values["version"], entry)
	}
	if err != nil {
		return nil, err
	}
	tools, err := a.tools()
	if err != nil {
		return nil, err
	}
	if scope == "project" {
		tools = append([]string{"shared"}, tools...)
	}
	var replacements []replacement
	defer a.discardUncommitted(&replacements)
	var changes []map[string]any
	for i := range nodes {
		n := &nodes[i]
		old := entry.Skills[n.Slug]
		if old.ID != "" && n.ID != "" && old.ID != n.ID {
			return nil, fail(6, "published skill identity differs from installed lock; inspect before replacing")
		}
		var targets []installedTarget
		seen := map[string]bool{}
		for _, tool := range tools {
			tool = strings.TrimSpace(tool)
			root, err := toolRoot(tool, scope, project)
			if err != nil {
				return nil, err
			}
			path := filepath.Join(root, n.Slug)
			if seen[path] {
				continue
			}
			seen[path] = true
			boundary := root
			if scope == "project" {
				boundary = project
			}
			if err = noSymlinkPath(boundary, path); err != nil {
				return nil, err
			}
			stored := path
			if scope == "project" {
				stored, _ = filepath.Rel(project, path)
				stored = filepath.ToSlash(stored)
			}
			target := installedTarget{Tool: tool, Scope: scope, Path: stored, PackageChecksum: n.Checksum, Version: n.Version}
			if _, err = os.Lstat(path); err == nil && !a.options.flags["force"] {
				var prior *installedTarget
				for j := range old.Targets {
					if old.Targets[j].Path == stored {
						prior = &old.Targets[j]
						break
					}
				}
				if prior == nil {
					pkg, dir, e := currentPackage(path)
					if e != nil || pkg != n.Checksum {
						return nil, fail(6, "existing untracked skill; review before using --force")
					}
					prior = &installedTarget{PackageChecksum: pkg, Checksum: dir}
				}
				pkg, dir, err := currentPackage(path)
				if err != nil {
					return nil, err
				}
				target.Extra = prior.Extra
				if prior.Checksum != "" && dir != prior.Checksum || prior.PackageChecksum != "" && pkg != prior.PackageChecksum {
					return nil, fail(9, "local customization detected; existing files preserved")
				}
			}
			targets = append(targets, target)
		}
		changes = append(changes, map[string]any{"slug": n.Slug, "version": n.Version, "targets": targets})
		if a.options.flags["dry-run"] {
			continue
		}
		if n.Files == nil {
			if err = c.downloadNode(n); err != nil {
				return nil, err
			}
		}
		for j := range targets {
			path, err := targetPath(targets[j], n.Slug, project)
			if err != nil {
				return nil, err
			}
			r, err := stageDirectory(path, n.Files)
			if err != nil {
				return nil, err
			}
			r.Root = filepath.Dir(path)
			if scope == "project" {
				r.Root = project
			}
			replacements = append(replacements, r)
			targets[j].Checksum = folderChecksum(n.Files)
		}
		for _, prior := range old.Targets {
			if !seen[func() string {
				p := prior.Path
				if !filepath.IsAbs(p) {
					p = filepath.Join(project, p)
				}
				return p
			}()] {
				targets = append(targets, prior)
			}
		}
		pin := old.Pinned
		if a.options.flags["pin"] {
			pin = n.Version
		}
		if n.Slug == rootSlug && a.options.values["version"] != "" {
			pin = n.Version
		}
		if a.options.flags["public"] {
			if old.Extra == nil {
				old.Extra = map[string]json.RawMessage{}
			}
			old.Extra["publicToken"], _ = json.Marshal(args[1])
			pin = n.Version
		}
		entry.Skills[n.Slug] = installedSkill{Extra: old.Extra, Name: n.Slug, Slug: n.Slug, ID: n.ID, Version: n.Version, Checksum: n.Checksum, Targets: targets, Pinned: pin, Added: old.Added}
	}
	if a.options.flags["dry-run"] {
		return map[string]any{"dryRun": true, "changes": changes}, nil
	}
	// Secret/package coupling is assembled before activation; none of the staged packages is visible yet.
	var secretRows []replacement
	var secretPaths map[string]string
	if !a.options.flags["public"] {
		secretRows, secretPaths, err = a.stageInstallSecrets(c, workspace, nodes)
	}
	if err != nil {
		return nil, err
	}
	replacements = append(replacements, secretRows...)
	lock.Workspaces[workspace] = entry
	b, _ := json.MarshalIndent(lock, "", "  ")
	r, err := stageFile(lockPath, append(b, '\n'), scope != "project")
	if err != nil {
		return nil, err
	}
	r.Root = lockRoot
	if scope == "project" {
		r.Root = project
	}
	replacements = append(replacements, r)
	if err = a.commitTransaction(replacements); err != nil {
		return nil, err
	}
	reports := []map[string]any{}
	for _, n := range nodes {
		if a.options.flags["public"] {
			continue
		}
		path := "/skills/" + n.Slug + "/install"
		payload := map[string]any{"version": n.Version, "agent": "skillpack-cli", "source": "agent", "checksum": n.Checksum}
		if n.Local {
			path = "/local-skills/skillpack/installed"
			payload = map[string]any{"version": n.Version, "agent": "skillpack-cli"}
		}
		b, _ := json.Marshal(payload)
		_, reportErr := c.json("POST", path, b)
		state := "reported"
		if reportErr != nil {
			state = "pending"
		}
		reports = append(reports, map[string]any{"slug": n.Slug, "status": state})
	}
	usageStatus := "pending"
	store, storeErr := usage.OpenStore("")
	if storeErr == nil {
		_, storeErr = a.registerInventory(store)
		store.Close()
		if storeErr == nil {
			usageStatus = "registered"
		}
	}
	var prerequisites any
	if a.options.flags["public"] {
		var m map[string]any
		_ = json.Unmarshal(nodes[0].Files["companion.json"], &m)
		prerequisites = map[string]any{"dependencies": m["dependencies"], "environment": m["environment"], "database": m["database"]}
	}
	return map[string]any{"status": "installed", "changes": changes, "reports": reports, "secretProjections": secretPaths, "usageInventory": usageStatus, "prerequisites": prerequisites}, nil
}

func (a *app) stageInstallSecrets(c *client, workspace string, nodes []installNode) ([]replacement, map[string]string, error) {
	var skills []map[string]string
	for _, n := range nodes {
		if n.Local {
			continue
		}
		var m struct {
			Environment struct {
				Secrets map[string]any `json:"secrets"`
			} `json:"environment"`
		}
		_ = json.Unmarshal(n.Files["companion.json"], &m)
		home, err := legacyHome()
		if err != nil {
			return nil, nil, err
		}
		_, projectionErr := os.Stat(filepath.Join(home, "secrets", workspace, n.Slug, ".env"))
		if len(m.Environment.Secrets) > 0 || projectionErr == nil {
			skills = append(skills, map[string]string{"slug": n.Slug, "version": n.Version})
		}
	}
	if len(skills) == 0 {
		return nil, nil, nil
	}
	p, err := c.preflightSecrets(skills)
	if err != nil {
		return nil, nil, err
	}
	values, err := c.redeemSecrets(p)
	if err != nil {
		return nil, nil, err
	}
	selected := []string{}
	for _, skill := range skills {
		selected = append(selected, skill["slug"])
	}
	return a.stageProjections(workspace, values, selected)
}

func (a *app) frozenSync() (any, error) {
	project, err := projectRoot(a.options.values["project"])
	if err != nil {
		return nil, err
	}
	path := filepath.Join(project, ".companion", "skills.lock.json")
	if err = noSymlinkPath(project, path); err != nil {
		return nil, err
	}
	if _, err = os.Stat(path); err != nil {
		return nil, fail(4, "project skills lockfile missing")
	}
	lock, err := readLock(path)
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
	unlockScope, err := acquireLock(path + ".lock")
	if err != nil {
		return nil, err
	}
	defer unlockScope()
	lock, err = readLock(path)
	if err != nil {
		return nil, err
	}
	type missingTarget struct {
		target                                           installedTarget
		slug, version, hash, workspace, api, publicToken string
	}
	var missing []missingTarget
	verified := map[string]map[string][]byte{}
	count := 0
	for workspaceID, workspace := range lock.Workspaces {
		for slug, skill := range workspace.Skills {
			for _, target := range skill.Targets {
				if target.Scope != "project" {
					return nil, fail(6, "project lock contains a non-project destination")
				}
				destination, err := targetPath(target, slug, project)
				if err != nil {
					return nil, err
				}
				expected := target.PackageChecksum
				if expected == "" {
					expected = skill.Checksum
				}
				if !strings.HasPrefix(expected, "sha256:") || len(expected) != 71 {
					return nil, fail(5, "locked package checksum invalid")
				}
				version := target.Version
				if version == "" {
					version = skill.Version
				}
				if _, err := os.Lstat(destination); os.IsNotExist(err) {
					var publicToken string
					_ = json.Unmarshal(skill.Extra["publicToken"], &publicToken)
					missing = append(missing, missingTarget{target, slug, version, expected, workspaceID, workspace.API, publicToken})
					continue
				} else if err != nil {
					return nil, err
				}
				files, err := scanPackage(destination)
				if err != nil {
					return nil, err
				}
				_, hash, err := canonicalPackage(files)
				if err != nil {
					return nil, err
				}
				if hash != expected {
					return nil, fail(9, "locked package drift; files and lockfile preserved")
				}
				verified[hash] = files
				count++
			}
		}
	}
	var replacements []replacement
	defer a.discardUncommitted(&replacements)
	var remote *client
	var remoteWorkspace string
	for _, m := range missing {
		files := verified[m.hash]
		if files == nil {
			if remote == nil {
				remote, err = a.client()
				if err != nil {
					return nil, fail(3, "locked package unavailable locally; login to restore its exact version")
				}
				status, err := remote.status()
				if err != nil {
					return nil, err
				}
				remoteWorkspace = status.Workspace.ID
			}
			if remote.base != m.api || remoteWorkspace != m.workspace {
				return nil, fail(7, "credentials do not match locked API and organization")
			}
			if !skillName.MatchString(m.slug) || !validSegment(m.version) {
				return nil, fail(5, "invalid locked skill or version")
			}
			n := installNode{Slug: m.slug, Version: m.version, Checksum: m.hash, Local: m.slug == "skillpack"}
			if m.publicToken != "" {
				n, err = remote.publicNode(m.publicToken, m.version)
				if err == nil && (n.Slug != m.slug || n.Checksum != m.hash) {
					err = fail(5, "public package differs from frozen lock")
				}
			} else {
				err = remote.downloadNode(&n)
			}
			if err != nil {
				return nil, err
			}
			files = n.Files
			verified[m.hash] = files
		}
		if !a.options.flags["dry-run"] {
			destination, err := targetPath(m.target, m.slug, project)
			if err != nil {
				return nil, err
			}
			r, err := stageDirectory(destination, files)
			if err != nil {
				return nil, err
			}
			r.Root = project
			replacements = append(replacements, r)
		}
		count++
	}
	if err = a.commitTransaction(replacements); err != nil {
		return nil, err
	}
	return map[string]any{"status": "verified", "targets": count, "restored": len(missing), "dryRun": a.options.flags["dry-run"], "lockChanged": false, "runtimePrerequisites": "not_verified_offline"}, nil
}
