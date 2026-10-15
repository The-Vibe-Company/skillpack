package cli

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/term"
	"gopkg.in/yaml.v3"
)

var githubCommitPattern = regexp.MustCompile(`^[a-f0-9]{40}$`)
var githubChecksumPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

// A source is authority for a remote restore, so validate even when all copies exist.
func validateGitHubLock(lock installLock) error {
	for workspaceID, workspace := range lock.Workspaces {
		for slug, skill := range workspace.Skills {
			s := skill.Source
			if s == nil {
				if strings.HasPrefix(workspaceID, "github:") {
					return fail(5, "GitHub lock source is missing")
				}
				continue
			}
			if lock.Version != 3 || s.Type != "github" || workspaceID != "github:"+s.Repository || workspace.API != "https://api.github.com" || !githubCommitPattern.MatchString(s.Commit) || skill.Version != s.Commit || !skillName.MatchString(slug) || skill.Slug != slug || skill.Name != slug || skill.ID != "" || !githubChecksumPattern.MatchString(skill.Checksum) {
				return fail(5, "invalid GitHub lock identity")
			}
			if !validGitHubRepository(s.Repository) || validateGitHubPackagePath(s.Path) != nil {
				return fail(5, "invalid GitHub lock source")
			}
			if s.Ref != nil && !validGitHubRef(*s.Ref) {
				return fail(5, "invalid GitHub lock ref")
			}

			for _, target := range skill.Targets {
				if target.Version != "" && !githubCommitPattern.MatchString(target.Version) || target.PackageChecksum != "" && !githubChecksumPattern.MatchString(target.PackageChecksum) || target.Checksum != "" && !githubChecksumPattern.MatchString(target.Checksum) {
					return fail(5, "invalid GitHub target identity")
				}
			}
		}
	}
	return nil
}

func githubPathSuffix(path string) string {
	if path == "" {
		return ""
	}
	return "/" + path
}

func sameGitHubSource(a, b *githubSource) bool {
	return a != nil && b != nil && a.Type == "github" && b.Type == "github" && a.Repository == b.Repository && a.Path == b.Path
}

func checkGitHubCollision(lock installLock, workspace, slug string, source *githubSource) error {
	for id, other := range lock.Workspaces {
		if prior, ok := other.Skills[slug]; ok && (source != nil || prior.Source != nil) && (id != workspace || !sameGitHubSource(source, prior.Source)) {
			return fail(6, "skill name belongs to another source; remove that installation explicitly or choose another scope")
		}
	}
	return nil
}

func hasGitHubTarget(old installedSkill, target installedTarget) bool {
	for _, prior := range old.Targets {
		if prior.Path == target.Path && prior.PackageChecksum == target.PackageChecksum {
			return true
		}
	}
	return false
}

func safeGitHubDisplay(value string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, value)
}

func githubWarning(source githubSource, executables []string) string {
	flagged := append([]string(nil), executables...)
	sort.Strings(flagged)
	executableText := "none"
	if len(flagged) > 0 {
		executableText = safeGitHubDisplay(strings.Join(flagged, ", "))
	}
	return fmt.Sprintf("WARNING: This third-party skill has not been verified by Skillpack.\nSource: https://github.com/%s/tree/%s/%s\nCommit: %s\nExecutable files: %s\nIts instructions may cause your agent to run commands or access your files and credentials.\nSkillpack will only copy files; it will never run package scripts.", safeGitHubDisplay(source.Repository), safeGitHubDisplay(source.Commit), safeGitHubDisplay(source.Path), safeGitHubDisplay(source.Commit), executableText)
}

func (a *app) confirmGitHub(warning string, changed bool) error {
	if a.options.flags["json"] {
		if err := json.NewEncoder(a.diagnostic).Encode(map[string]any{"warning": warning, "source": "github", "verified": false}); err != nil {
			return err
		}
	} else if _, err := fmt.Fprintln(a.diagnostic, warning); err != nil {
		return err
	}
	if a.options.flags["dry-run"] || a.options.flags["frozen"] || a.options.flags["yes"] {
		return nil
	}
	input, ok := a.in.(*os.File)
	if a.options.flags["json"] || !ok || !term.IsTerminal(int(input.Fd())) {
		return fail(2, "third-party skill requires confirmation; inspect the source and use --yes in CI or non-interactive mode")
	}
	if !changed {
		return nil
	}
	if _, err := fmt.Fprintln(a.diagnostic, "Install this skill? [y/N]"); err != nil {
		return err
	}
	return readGitHubApproval(a)
}

func readGitHubApproval(a *app) error {
	answer, err := bufio.NewReader(a.in).ReadString('\n')
	if err != nil {
		return fail(6, "GitHub installation cancelled; no package or lock changes")
	}
	switch strings.ToLower(strings.TrimSpace(answer)) {
	case "y", "yes":
		return nil
	}
	return fail(6, "GitHub installation cancelled; no package or lock changes")
}

// Sharing is deliberately a post-install, explicit operation. Publish only a copy;
// server normalization must never replace the pinned local GitHub bytes.
func (a *app) shareGitHub(source githubSource, files map[string][]byte) (any, error) {
	result, err := a.publishGitHubCopy(source, files)
	if err != nil {
		return map[string]any{"status": "failed"}, fail(6, "local installation succeeded; organization sharing failed: "+err.Error())
	}
	return result, nil
}

func (a *app) publishGitHubCopy(source githubSource, files map[string][]byte) (any, error) {
	c, err := a.client()
	if err != nil {
		return nil, err
	}
	status, err := c.status()
	if err != nil {
		return nil, err
	}
	if a.options.flags["json"] {
		_ = json.NewEncoder(a.diagnostic).Encode(map[string]any{"sharingWorkspace": status.Workspace.ID, "sharingWorkspaceName": safeGitHubDisplay(status.Workspace.Name)})
	} else {
		fmt.Fprintf(a.diagnostic, "Sharing to organization: %s (%s)\n", safeGitHubDisplay(status.Workspace.Name), safeGitHubDisplay(status.Workspace.ID))
	}
	name, err := validatePackage(files)
	if err != nil {
		return nil, err
	}
	if _, err = c.json("GET", "/skills/"+name, nil); err == nil {
		return nil, fail(6, "organization slug already exists; GitHub sharing only creates new skills")
	} else if ce, ok := err.(*commandError); !ok || ce.code != 4 {
		return nil, err
	}
	copied, err := githubShareFiles(source, files)
	if err != nil {
		return nil, err
	}
	archive, err := packageZip(copied)
	if err != nil {
		return nil, err
	}
	body, err := c.request("POST", "/skills?action=publish&scope=org&expect_slug="+name, archive, "application/zip", 16<<20)
	if err != nil {
		return nil, err
	}
	var published any
	if json.Unmarshal(body, &published) != nil {
		return nil, fail(8, "sharing response unreadable; inspect organization skill history before retrying")
	}
	return map[string]any{"status": "published", "workspace": status.Workspace.ID, "published": published}, nil
}

func githubShareFiles(source githubSource, files map[string][]byte) (map[string][]byte, error) {
	raw := strings.ReplaceAll(string(files["SKILL.md"]), "\r\n", "\n")
	end := strings.Index(raw[4:], "\n---") + 4
	var front map[string]any
	if err := yaml.Unmarshal([]byte(raw[4:end]), &front); err != nil {
		return nil, fail(5, "invalid GitHub frontmatter")
	}
	metadata, _ := front["metadata"].(map[string]any)
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["github_repository"], metadata["github_path"], metadata["github_commit"] = source.Repository, source.Path, source.Commit
	ref := "(default)"
	if source.Ref != nil {
		ref = *source.Ref
	}
	metadata["github_ref"] = ref
	front["metadata"] = metadata
	header, err := yaml.Marshal(front)
	if err != nil {
		return nil, err
	}
	copied := make(map[string][]byte, len(files))
	for p, b := range files {
		copied[p] = b
	}
	copied["SKILL.md"] = []byte("---\n" + string(header) + raw[end:])
	return copied, nil
}

func (a *app) showGitHubPlan(source githubSource, previous string, targets []installedTarget) error {
	if a.options.flags["json"] {
		return json.NewEncoder(a.diagnostic).Encode(map[string]any{"githubPlan": map[string]any{"source": source, "previousCommit": previous, "targets": targets}})
	}
	ref := "(default branch)"
	if source.Ref != nil {
		ref = *source.Ref
	}
	if _, err := fmt.Fprintf(a.diagnostic, "Requested ref: %s\nPrevious commit: %s\n", safeGitHubDisplay(ref), safeGitHubDisplay(previous)); err != nil {
		return err
	}
	for _, target := range targets {
		if _, err := fmt.Fprintf(a.diagnostic, "Target (%s, %s): %s\n", target.Tool, target.Scope, safeGitHubDisplay(target.Path)); err != nil {
			return err
		}
	}
	return nil
}
