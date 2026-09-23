package cli

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func isPinned(skill installedSkill) bool {
	return skill.Pinned != nil && skill.Pinned != false && skill.Pinned != ""
}

// Each dependency closure is atomic; an unrelated root's failure is reported
// without claiming that the entire update succeeded.
func (a *app) update() (any, error) {
	args := a.options.args
	if !a.options.flags["all"] && len(args) != 2 || a.options.flags["all"] && len(args) != 1 {
		return nil, fail(2, "use update <slug> or update --all")
	}
	project, err := projectRoot(a.options.values["project"])
	if err != nil {
		return nil, err
	}
	home, err := legacyHome()
	if err != nil {
		return nil, err
	}
	scope := a.options.values["scope"]
	if scope == "" {
		scope = "user"
		if _, err := os.Stat(filepath.Join(project, ".companion", "skills.lock.json")); err == nil {
			scope = "project"
		}
	}
	if scope != "project" && scope != "user" {
		return nil, fail(2, "scope must be project or user")
	}
	root := home
	if scope == "project" {
		root = filepath.Join(project, ".companion")
	}
	lock, err := readLock(filepath.Join(root, "skills.lock.json"))
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
	workspace, ok := lock.Workspaces[status.Workspace.ID]
	if !ok {
		return nil, fail(4, "no installed skills for this organization and scope")
	}
	if workspace.API != c.base {
		return nil, fail(6, "locked API differs from active profile")
	}
	slugs := []string{}
	if a.options.flags["all"] {
		for slug := range workspace.Skills {
			slugs = append(slugs, slug)
		}
		sort.Strings(slugs)
	} else {
		slugs = append(slugs, args[1])
	}
	rows := []map[string]any{}
	failed := false
	for _, slug := range slugs {
		skill, ok := workspace.Skills[slug]
		if !ok {
			rows = append(rows, map[string]any{"slug": slug, "status": "failed", "code": 4})
			failed = true
			continue
		}
		if isPinned(skill) && a.options.values["version"] == "" {
			rows = append(rows, map[string]any{"slug": slug, "status": "pinned", "version": skill.Version})
			continue
		}
		child := *a
		child.options = a.options
		child.options.args = []string{"install", slug}
		var publicToken string
		_ = json.Unmarshal(skill.Extra["publicToken"], &publicToken)
		if publicToken != "" {
			child.options.args = []string{"install", publicToken}
			child.options.flags = map[string]bool{}
			for k, v := range a.options.flags {
				child.options.flags[k] = v
			}
			child.options.flags["public"] = true
		}
		child.options.values = map[string]string{}
		for k, v := range a.options.values {
			child.options.values[k] = v
		}
		child.options.values["scope"] = scope
		if child.options.values["tools"] == "" {
			selected := []string{}
			seen := map[string]bool{}
			for _, target := range skill.Targets {
				if target.Scope == scope && target.Tool != "shared" && !seen[target.Tool] {
					selected = append(selected, target.Tool)
					seen[target.Tool] = true
				}
			}
			if len(selected) > 0 {
				child.options.values["tools"] = strings.Join(selected, ",")
			}
		}
		result, err := child.install()
		if err != nil {
			code := 1
			var ce *commandError
			if errors.As(err, &ce) {
				code = ce.code
			}
			rows = append(rows, map[string]any{"slug": slug, "status": "failed", "code": code, "error": err.Error()})
			failed = true
		} else {
			rows = append(rows, map[string]any{"slug": slug, "status": "updated", "result": result})
		}
	}
	result := map[string]any{"results": rows, "complete": !failed}
	if failed {
		return result, fail(6, "one or more skills were preserved because their update failed; inspect results")
	}
	return result, nil
}
