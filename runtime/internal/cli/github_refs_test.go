package cli

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestGitHubRefIdentities(t *testing.T) {
	a, b := strings.Repeat("a", 40), strings.Repeat("b", 40)
	for _, tc := range []struct {
		name, ref string
		refs      map[string]string
		want      string
		code      int
	}{
		{"default", "HEAD", map[string]string{"HEAD": a}, a, 0},
		{"branch", "feature/review", map[string]string{"refs/heads/feature/review": a}, a, 0},
		{"lightweight tag", "v1", map[string]string{"refs/tags/v1": a}, a, 0},
		{"annotated tag", "v1", map[string]string{"refs/tags/v1": b, "refs/tags/v1^{}": a}, a, 0},
		{"full SHA", strings.ToUpper(a), nil, a, 0},
		{"unknown", "missing", nil, "", 4},
		{"ambiguous branch and tag", "v1", map[string]string{"refs/heads/v1": a, "refs/tags/v1": b}, "", 5},
		{"invalid SHA", "main", map[string]string{"refs/heads/main": "bad"}, "", 8},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, e := commitForGitHubRef(tc.refs, tc.ref)
			if got != tc.want || tc.code == 0 && e != nil || tc.code != 0 && githubCode(e) != tc.code {
				t.Fatalf("got %q %v", got, e)
			}
		})
	}
	r := newGitHubResolver()
	r.listRefs = func(context.Context, string, []string) (map[string]string, error) {
		t.Fatal("pinned SHA resolved refs")
		return nil, nil
	}
	if got, e := r.resolveRef(context.Background(), "acme/skills", a); got != a || e != nil {
		t.Fatal(got, e)
	}
}

func TestGitHubGitLookupIsolatesEnvironment(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture uses a POSIX shell; ref behavior also covered platform-independently")
	}
	directory := t.TempDir()
	script := `#!/bin/sh
if [ -n "$GITHUB_TOKEN" ] || [ -n "$GIT_CONFIG_COUNT" ] || [ -n "$GIT_ASKPASS" ]; then exit 1; fi
if [ "$GIT_CONFIG_NOSYSTEM" != 1 ] || [ "$GIT_TERMINAL_PROMPT" != 0 ]; then exit 1; fi
if [ -n "$HOME" ]; then exit 1; fi
case "$*" in *https://github.com/acme/skills.git*) ;; *) exit 1;; esac
printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/main\n'
`
	if e := os.WriteFile(filepath.Join(directory, "git"), []byte(script), 0755); e != nil {
		t.Fatal(e)
	}
	t.Setenv("PATH", directory)
	t.Setenv("GITHUB_TOKEN", "fixture-value")
	t.Setenv("GIT_ASKPASS", "untrusted")
	t.Setenv("GIT_CONFIG_COUNT", "1")
	refs, e := readGitHubRefs(context.Background(), "acme/skills", githubRefPatterns("main"))
	if e != nil || refs["refs/heads/main"] != strings.Repeat("a", 40) {
		t.Fatal(refs, e)
	}
	// Bounded stdout rejects a noisy provider without including the output.
	if e := os.WriteFile(filepath.Join(directory, "git"), []byte("#!/bin/sh\nwhile :; do printf 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; done\n"), 0755); e != nil {
		t.Fatal(e)
	}
	if _, e = readGitHubRefs(context.Background(), "acme/skills", []string{"HEAD"}); e == nil {
		t.Fatal("unbounded refs accepted")
	}
}

func TestGitHubTreeSelectionChecksAncestorsAndCollisions(t *testing.T) {
	sha := strings.Repeat("a", 40)
	dir := func(path string) githubTreeEntry {
		return githubTreeEntry{Path: path, Type: "tree", Mode: "040000", SHA: sha}
	}
	file := func(path string) githubTreeEntry {
		return githubTreeEntry{Path: path, Type: "blob", Mode: "100644", SHA: sha, Size: 1}
	}
	for _, tc := range []struct {
		name, path string
		entries    []githubTreeEntry
	}{
		{"ancestor symlink", "skills/review", []githubTreeEntry{{Path: "skills", Type: "blob", Mode: "120000", SHA: sha}}},
		{"ancestor submodule without gitmodules", "skills/review", []githubTreeEntry{{Path: "skills", Type: "commit", Mode: "160000", SHA: sha}}},
		{"submodule without gitmodules", "review", []githubTreeEntry{dir("review"), {Path: "review/vendor", Type: "commit", Mode: "160000", SHA: sha}}},
		{"Unicode collision", "review", []githubTreeEntry{dir("review"), file("review/caf\u00e9.txt"), file("review/cafe\u0301.txt")}},
		{"ancestor sibling case collision", "review", []githubTreeEntry{dir("review"), dir("Review")}},
		{"duplicate directory", "review", []githubTreeEntry{dir("review"), dir("review")}},
		{"file directory collision", "review", []githubTreeEntry{dir("review"), file("review/a"), file("review/a/b")}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, e := githubSelectedTree(tc.entries, tc.path); githubCode(e) != 5 {
				t.Fatal(e)
			}
		})
	}
	if _, e := githubSelectedTree([]githubTreeEntry{dir("other")}, "missing"); githubCode(e) != 4 {
		t.Fatal("missing selection", e)
	}
}
