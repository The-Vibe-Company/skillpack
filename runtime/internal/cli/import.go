package cli

import (
	"encoding/json"
	"os"
	"path/filepath"
)

func (a *app) importLock() (any, error) {
	if len(a.options.args) != 2 {
		return nil, fail(2, "use import-lock <companion.lock> --project PATH")
	}
	project, err := projectRoot(a.options.values["project"])
	if err != nil {
		return nil, err
	}
	source, err := filepath.Abs(a.options.args[1])
	if err != nil {
		return nil, err
	}
	if err = noSymlinkPath(project, source); err != nil {
		return nil, err
	}
	body, err := os.ReadFile(source)
	if err != nil {
		return nil, err
	}
	var legacy struct {
		Version  int `json:"lockfileVersion"`
		Registry struct {
			URL string `json:"url"`
			Org string `json:"orgId"`
		} `json:"registry"`
		Skills map[string]struct {
			Name     string `json:"name"`
			Pinned   any    `json:"pinned"`
			Version  string `json:"resolved"`
			Checksum string `json:"checksum"`
			Path     string `json:"installPath"`
			Added    string `json:"addedAt"`
		} `json:"skills"`
	}
	if json.Unmarshal(body, &legacy) != nil || legacy.Version != 1 || !validSegment(legacy.Registry.Org) {
		return nil, fail(5, "legacy export needs a valid organization and v1 schema")
	}
	base, err := normalizeAPI(legacy.Registry.URL)
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
	path := filepath.Join(project, ".companion", "skills.lock.json")
	if err = noSymlinkPath(project, path); err != nil {
		return nil, err
	}
	unlockScope, err := acquireLock(path + ".lock")
	if err != nil {
		return nil, err
	}
	defer unlockScope()
	lock, err := readLock(path)
	if err != nil {
		return nil, err
	}
	if len(lock.Workspaces) > 0 {
		return nil, fail(6, "destination lock already contains installations; preserve both and resolve explicitly")
	}
	workspace := workspaceLock{API: base, Skills: map[string]installedSkill{}}
	tools, err := a.tools()
	if err != nil {
		return nil, err
	}
	tools = append([]string{"shared"}, tools...)
	var rows []replacement
	defer a.discardUncommitted(&rows)
	for slug, skill := range legacy.Skills {
		if !skillName.MatchString(slug) || skill.Name != slug || !validSegment(skill.Version) {
			return nil, fail(5, "legacy skill identity invalid")
		}
		old := skill.Path
		if !filepath.IsAbs(old) {
			old = filepath.Join(project, filepath.FromSlash(old))
		}
		if err = noSymlinkPath(project, old); err != nil {
			return nil, err
		}
		files, err := scanPackage(old)
		if err != nil {
			return nil, err
		}
		_, checksum, err := canonicalPackage(files)
		if err != nil {
			return nil, err
		}
		if checksum != skill.Checksum {
			return nil, fail(9, "legacy package is missing or modified; import preserved all originals")
		}
		name, err := validatePackage(files)
		if err != nil || name != slug {
			return nil, fail(5, "legacy package identity differs from lock")
		}
		targets := []installedTarget{}
		seen := map[string]bool{}
		for _, tool := range tools {
			root, err := toolRoot(tool, "project", project)
			if err != nil {
				return nil, err
			}
			destination := filepath.Join(root, slug)
			if seen[destination] {
				continue
			}
			seen[destination] = true
			if err = noSymlinkPath(project, destination); err != nil {
				return nil, err
			}
			if _, err = os.Lstat(destination); err == nil {
				actual, _, err := currentPackage(destination)
				if err != nil || actual != checksum {
					return nil, fail(9, "destination contains different local content")
				}
			} else if !os.IsNotExist(err) {
				return nil, err
			}
			relative, _ := filepath.Rel(project, destination)
			targets = append(targets, installedTarget{Tool: tool, Scope: "project", Path: filepath.ToSlash(relative), Version: skill.Version, Checksum: folderChecksum(files), PackageChecksum: checksum})
			if !a.options.flags["dry-run"] {
				r, err := stageDirectory(destination, files)
				if err != nil {
					return nil, err
				}
				r.Root = project
				rows = append(rows, r)
			}
		}
		var manifest struct {
			Metadata struct {
				ID string `json:"companionSkillId"`
			} `json:"metadata"`
		}
		_ = json.Unmarshal(files["companion.json"], &manifest)
		workspace.Skills[slug] = installedSkill{Name: slug, Slug: slug, ID: manifest.Metadata.ID, Version: skill.Version, Checksum: checksum, Targets: targets, Pinned: skill.Pinned, Added: skill.Added}
	}
	if !a.options.flags["dry-run"] {
		lock.Workspaces[legacy.Registry.Org] = workspace
		b, _ := json.MarshalIndent(lock, "", "  ")
		r, err := stageFile(path, b, false)
		if err != nil {
			return nil, err
		}
		r.Root = project
		rows = append(rows, r)
		if err = a.commitTransaction(rows); err != nil {
			return nil, err
		}
	}
	return map[string]any{"status": "imported", "skills": len(workspace.Skills), "dryRun": a.options.flags["dry-run"], "sourcePreserved": true}, nil
}
