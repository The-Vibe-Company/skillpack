package cli

import (
	"bytes"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const installGitHubCommitA = "1111111111111111111111111111111111111111"
const installGitHubCommitB = "2222222222222222222222222222222222222222"

type installGitHubFixture struct {
	branch   string
	requests []string
	offline  bool
	private  bool
	fallback http.RoundTripper
	files    map[string]map[string][]byte
}

func installGitHubBlob(data []byte) string {
	h := sha1.New()
	fmt.Fprintf(h, "blob %d%c", len(data), 0)
	h.Write(data)
	return hex.EncodeToString(h.Sum(nil))
}

func newInstallGitHubFixture(t *testing.T) (*installGitHubFixture, string) {
	t.Helper()
	home := t.TempDir()
	for k, v := range map[string]string{"HOME": home, "USERPROFILE": home, "SKILLPACK_HOME": filepath.Join(home, "client"), "SKILLPACK_LEGACY_HOME": filepath.Join(home, "legacy"), "SKILLPACK_RUNTIME_HOME": filepath.Join(home, "runtime"), "SKILLPACK_API_KEY": "", "SKILLPACK_API_URL": "", "GITHUB_TOKEN": ""} {
		t.Setenv(k, v)
	}
	f := &installGitHubFixture{branch: installGitHubCommitA, fallback: http.DefaultTransport, files: map[string]map[string][]byte{}}
	for _, commit := range []string{installGitHubCommitA, installGitHubCommitB} {
		f.files[commit] = map[string][]byte{"SKILL.md": []byte("---\nname: review\ndescription: Review fixture\nlicense: MIT\n---\n" + commit + "\n"), "scripts/check.sh": []byte("#!/bin/sh\nexit 99\n")}
	}
	http.DefaultTransport = f
	t.Cleanup(func() { http.DefaultTransport = f.fallback })
	return f, filepath.Join(home, "project")
}

func (f *installGitHubFixture) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Host != "api.github.com" {
		return f.fallback.RoundTrip(r)
	}
	f.requests = append(f.requests, r.URL.Path)
	if f.offline {
		return nil, fmt.Errorf("offline")
	}
	w := httptest.NewRecorder()
	write := func(v any) { _ = json.NewEncoder(w).Encode(v) }
	path := strings.TrimPrefix(r.URL.Path, "/repos/acme/skills")
	if strings.HasPrefix(r.URL.Path, "/repos/acme/other") {
		path = strings.TrimPrefix(r.URL.Path, "/repos/acme/other")
	}
	switch {
	case path == "":
		write(map[string]any{"private": f.private, "visibility": "public", "default_branch": "main"})
	case strings.HasPrefix(path, "/commits/"):
		ref := strings.TrimPrefix(path, "/commits/")
		sha := ref
		if ref == "main" || ref == "v1.2" {
			sha = f.branch
		}
		if f.files[sha] == nil {
			w.WriteHeader(404)
		} else {
			write(map[string]any{"sha": sha})
		}
	case strings.HasPrefix(path, "/git/trees/"):
		id := strings.TrimPrefix(path, "/git/trees/")
		if f.files[id] != nil {
			write(map[string]any{"tree": []any{map[string]any{"path": "review", "type": "tree", "mode": "040000", "sha": strings.Repeat(string(id[0]+2), 40)}}})
			break
		}
		commit := ""
		if id == strings.Repeat("3", 40) {
			commit = installGitHubCommitA
		}
		if id == strings.Repeat("4", 40) {
			commit = installGitHubCommitB
		}
		if commit != "" {
			data := f.files[commit]["SKILL.md"]
			write(map[string]any{"tree": []any{map[string]any{"path": "SKILL.md", "type": "blob", "mode": "100644", "sha": installGitHubBlob(data), "size": len(data)}, map[string]any{"path": "scripts", "type": "tree", "mode": "040000", "sha": strings.Repeat("5", 40)}}})
			break
		}
		if id == strings.Repeat("5", 40) {
			data := f.files[installGitHubCommitA]["scripts/check.sh"]
			write(map[string]any{"tree": []any{map[string]any{"path": "check.sh", "type": "blob", "mode": "100755", "sha": installGitHubBlob(data), "size": len(data)}}})
			break
		}
		w.WriteHeader(404)
	case strings.HasPrefix(path, "/git/blobs/"):
		id := strings.TrimPrefix(path, "/git/blobs/")
		found := false
		for _, files := range f.files {
			for _, data := range files {
				if installGitHubBlob(data) == id {
					write(map[string]any{"size": len(data), "encoding": "base64", "content": base64.StdEncoding.EncodeToString(data)})
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		if !found {
			w.WriteHeader(404)
		}
	default:
		w.WriteHeader(404)
	}
	return w.Result(), nil
}

func installGitHubRun(t *testing.T, project string, extra ...string) (int, string, string) {
	t.Helper()
	args := []string{"install", "github:acme/skills/review", "--scope", "project", "--project", project, "--json"}
	return invoke(t, "", append(args, extra...)...)
}

func TestGitHubInstallAnonymousTargetsScopesAndFrozenSHA(t *testing.T) {
	for _, scope := range []string{"project", "user"} {
		t.Run(scope, func(t *testing.T) {
			f, project := newInstallGitHubFixture(t)
			args := []string{"install", "github:acme/skills/review", "--scope", scope, "--project", project, "--tools", "claude-code,codex,opencode", "--yes", "--json"}
			code, out, diag := invoke(t, "", args...)
			if code != 0 {
				t.Fatalf("install: %d %s %s", code, out, diag)
			}
			if !strings.Contains(diag, "not been verified") || !strings.Contains(diag, "scripts/check.sh") {
				t.Fatal("warning or executable list missing", diag)
			}
			lockPath := filepath.Join(os.Getenv("SKILLPACK_LEGACY_HOME"), "skills.lock.json")
			if scope == "project" {
				lockPath = filepath.Join(project, ".companion", "skills.lock.json")
			}
			lock, e := readLock(lockPath)
			if e != nil {
				t.Fatal(e)
			}
			skill := lock.Workspaces["github:acme/skills"].Skills["review"]
			if lock.Version != 3 || skill.Source == nil || skill.Source.Commit != installGitHubCommitA || skill.Source.Ref != nil || skill.ID != "" || len(skill.Targets) != 3 {
				t.Fatalf("wrong source/targets: %+v", skill)
			}
			for _, target := range skill.Targets {
				p, e := targetPath(target, "review", project)
				if e != nil {
					t.Fatal(e)
				}
				data, e := os.ReadFile(filepath.Join(p, "SKILL.md"))
				if e != nil || !bytes.Equal(data, f.files[installGitHubCommitA]["SKILL.md"]) {
					t.Fatal("target content", e)
				}
			}
			if scope == "user" {
				return
			}
			before, _ := os.ReadFile(lockPath)
			os.RemoveAll(filepath.Join(project, ".codex", "skills", "review"))
			f.offline = true
			code, out, diag = invoke(t, "", "sync", "--frozen", "--project", project, "--json")
			if code != 0 {
				t.Fatalf("offline copy: %d %s %s", code, out, diag)
			}
			f.offline = false
			f.branch = installGitHubCommitB
			f.requests = nil
			for _, target := range skill.Targets {
				p, _ := targetPath(target, "review", project)
				os.RemoveAll(p)
			}
			code, out, diag = invoke(t, "", "sync", "--frozen", "--project", project, "--json")
			if code != 0 {
				t.Fatalf("SHA restore: %d %s %s", code, out, diag)
			}
			for _, request := range f.requests {
				if strings.Contains(request, "/commits/") {
					t.Fatal("frozen resolved a ref", request)
				}
			}
			after, _ := os.ReadFile(lockPath)
			if !bytes.Equal(before, after) {
				t.Fatal("frozen changed lock")
			}
			data, _ := os.ReadFile(filepath.Join(project, ".codex", "skills", "review", "SKILL.md"))
			if !bytes.Equal(data, f.files[installGitHubCommitA]["SKILL.md"]) {
				t.Fatal("frozen followed moved ref")
			}
			f.private = true
			for _, target := range skill.Targets {
				p, _ := targetPath(target, "review", project)
				os.RemoveAll(p)
			}
			code, _, _ = invoke(t, "", "sync", "--frozen", "--project", project, "--json")
			if code == 0 {
				t.Fatal("private restore accepted")
			}
		})
	}
}

func TestGitHubInstallConfirmationDryRunAndCollision(t *testing.T) {
	_, project := newInstallGitHubFixture(t)
	code, _, diag := installGitHubRun(t, project)
	if code != 2 || !strings.Contains(diag, "--yes") {
		t.Fatal("noninteractive confirmation", code, diag)
	}
	lockPath := filepath.Join(project, ".companion", "skills.lock.json")
	if _, e := os.Stat(lockPath); !os.IsNotExist(e) {
		t.Fatal("refused install wrote lock")
	}
	code, _, _ = installGitHubRun(t, project, "--dry-run")
	if code != 0 {
		t.Fatal("dry-run asked for confirmation")
	}
	if _, e := os.Stat(lockPath); !os.IsNotExist(e) {
		t.Fatal("dry-run wrote lock")
	}
	target := filepath.Join(project, ".agents", "skills", "review")
	os.MkdirAll(target, 0755)
	os.WriteFile(filepath.Join(target, "SKILL.md"), []byte("custom"), 0644)
	code, _, _ = installGitHubRun(t, project, "--yes", "--force")
	if code != 6 {
		t.Fatal("untracked collision accepted", code)
	}
	os.RemoveAll(target)
	code, _, diag = installGitHubRun(t, project, "--yes")
	if code != 0 {
		t.Fatal("install", code, diag)
	}
	code, _, _ = invoke(t, "", "install", "github:acme/other/review", "--scope", "project", "--project", project, "--yes", "--json")
	if code != 6 {
		t.Fatal("another source collision not rejected", code)
	}
	os.WriteFile(filepath.Join(target, "SKILL.md"), []byte("custom"), 0644)
	code, _, _ = installGitHubRun(t, project, "--yes", "--force")
	if code != 9 {
		t.Fatal("force overwrote local changes", code)
	}
	for _, answer := range []string{"", "n\n", "yes"} {
		a := &app{in: strings.NewReader(answer)}
		if readGitHubApproval(a) == nil {
			t.Fatal("refusal/EOF accepted", answer)
		}
	}
	if e := readGitHubApproval(&app{in: strings.NewReader("yes\n")}); e != nil {
		t.Fatal(e)
	}
}

func TestGitHubUpdatePartialTargetsPinsAndDrift(t *testing.T) {
	f, project := newInstallGitHubFixture(t)
	if code, _, diag := installGitHubRun(t, project, "--yes"); code != 0 {
		t.Fatal(code, diag)
	}
	f.branch = installGitHubCommitB
	code, out, diag := invoke(t, "", "update", "github:acme/skills/review", "--scope", "project", "--project", project, "--tools", "codex", "--yes", "--json")
	if code != 0 {
		t.Fatal(code, out, diag)
	}
	for _, tool := range []string{"claude-code", "codex", "opencode"} {
		root, _ := toolRoot(tool, "project", project)
		data, _ := os.ReadFile(filepath.Join(root, "review", "SKILL.md"))
		want := installGitHubCommitB
		if tool == "claude-code" {
			want = installGitHubCommitA
		}
		if !strings.Contains(string(data), want) {
			t.Fatal("partial update changed unselected target", tool)
		}
	}
	lockPath := filepath.Join(project, ".companion", "skills.lock.json")
	before, _ := os.ReadFile(lockPath)
	lock, e := readLock(lockPath)
	if e != nil {
		t.Fatal(e)
	}
	for _, target := range lock.Workspaces["github:acme/skills"].Skills["review"].Targets {
		p, _ := targetPath(target, "review", project)
		os.RemoveAll(p)
	}
	code, out, diag = invoke(t, "", "sync", "--frozen", "--project", project, "--json")
	if code != 0 {
		t.Fatal("partial restore", code, out, diag)
	}
	if !strings.Contains(diag, installGitHubCommitA) || !strings.Contains(diag, installGitHubCommitB) {
		t.Fatal("frozen warnings omitted a target commit")
	}

	after, _ := os.ReadFile(lockPath)
	if !bytes.Equal(before, after) {
		t.Fatal("partial sync changed lock")
	}
	code, out, diag = invoke(t, "", "update", "--all", "--scope", "project", "--project", project, "--yes", "--json")
	if code != 0 {
		t.Fatal("anonymous update all", code, out, diag)
	}
	target := filepath.Join(project, ".codex", "skills", "review", "SKILL.md")
	os.WriteFile(target, []byte("custom"), 0644)
	code, _, _ = invoke(t, "", "update", "--all", "--scope", "project", "--project", project, "--yes", "--json")
	if code != 6 {
		t.Fatal("update all drift", code)
	}
	pinned := filepath.Join(filepath.Dir(project), "pinned")
	if code, _, diag := installGitHubRun(t, pinned, "--yes", "--pin"); code != 0 {
		t.Fatal(code, diag)
	}
	f.offline = true
	code, out, diag = invoke(t, "", "update", "--all", "--scope", "project", "--project", pinned, "--json")
	if code != 0 || !strings.Contains(out, "pinned") {
		t.Fatal("pin was resolved", code, out, diag)
	}
}

func TestGitHubSharingStrictOptInPreservesLocalSnapshot(t *testing.T) {
	_, project := newInstallGitHubFixture(t)
	writes := 0
	var archive []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/tokens/current":
			json.NewEncoder(w).Encode(map[string]any{"workspace": map[string]string{"id": "org", "name": "Team"}, "user": map[string]string{"id": "user"}, "token": map[string]string{"id": "token"}})
		case "/v1/skills/review":
			w.WriteHeader(404)
		case "/v1/skills":
			writes++
			if r.URL.Query().Get("scope") != "org" || r.URL.Query().Get("expect_skill_id") != "" {
				t.Error("sharing retargeted existing skill")
			}
			archive, _ = io.ReadAll(r.Body)
			json.NewEncoder(w).Encode(map[string]any{"id": "created", "version": "1.0.0"})
		default:
			t.Error("unexpected API route", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	// Synthetic credential stays in process environment, never in files or output.
	t.Setenv("SKILLPACK_API_KEY", "cmp_pat_"+strings.Repeat("x", 48))
	t.Setenv("SKILLPACK_API_URL", server.URL)
	code, out, diag := installGitHubRun(t, project, "--yes")
	if code != 0 || writes != 0 {
		t.Fatal("implicit sharing", code, writes, diag)
	}
	code, out, diag = installGitHubRun(t, project, "--share-org", "--yes", "--dry-run")
	if code != 0 || writes != 0 {
		t.Fatal("dry run shared", code, writes)
	}
	code, out, diag = installGitHubRun(t, project, "--share-org", "--yes")
	if code != 0 || writes != 1 {
		t.Fatal("opt-in sharing", code, out, diag, writes)
	}
	files, e := readPackage(archive)
	if e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(string(files["SKILL.md"]), "github_commit: "+`"`+installGitHubCommitA+`"`) && !strings.Contains(string(files["SKILL.md"]), "github_commit: "+installGitHubCommitA) {
		t.Fatal("provenance missing")
	}
	local, _ := os.ReadFile(filepath.Join(project, ".agents", "skills", "review", "SKILL.md"))
	if strings.Contains(string(local), "github_commit") {
		t.Fatal("server copy mutated original")
	}
	t.Setenv("SKILLPACK_API_KEY", "")
	code, out, diag = installGitHubRun(t, project, "--share-org", "--yes")
	if code != 6 || !strings.Contains(out, `"complete":false`) {
		t.Fatal("share partial result", code, out, diag)
	}
}

func TestGitHubLockCompatibilityAndIncompleteSourceFailsClosed(t *testing.T) {
	_, project := newInstallGitHubFixture(t)
	lockPath := filepath.Join(project, ".companion", "skills.lock.json")
	os.MkdirAll(filepath.Dir(lockPath), 0700)
	legacy := []byte(`{"lockfileVersion":2,"custom":"keep","workspaces":{}}`)
	os.WriteFile(lockPath, legacy, 0600)
	if code, _, diag := installGitHubRun(t, project, "--yes"); code != 0 {
		t.Fatal(code, diag)
	}
	data, _ := os.ReadFile(lockPath)
	if !bytes.Contains(data, []byte(`"custom": "keep"`)) {
		t.Fatal("migration lost extensions")
	}
	var lock installLock
	json.Unmarshal(data, &lock)
	skill := lock.Workspaces["github:acme/skills"].Skills["review"]
	skill.Source.Commit = ""
	lock.Workspaces["github:acme/skills"].Skills["review"] = skill
	data, _ = json.Marshal(lock)
	os.WriteFile(lockPath, data, 0600)
	if code, _, _ := invoke(t, "", "sync", "--frozen", "--project", project, "--json"); code != 5 {
		t.Fatal("incomplete source restored", code)
	}
	code, out, _ := invoke(t, "", "install", "--help")
	if code != 0 || !strings.Contains(out, "--share-org") || !strings.Contains(out, "--ref") || !strings.Contains(out, "--yes") {
		t.Fatal("help incomplete")
	}
}

func TestGitHubFrozenChecksumSubstitutionPreservesEverything(t *testing.T) {
	f, project := newInstallGitHubFixture(t)
	if code, _, diag := installGitHubRun(t, project, "--yes"); code != 0 {
		t.Fatal(code, diag)
	}
	path := filepath.Join(project, ".companion", "skills.lock.json")
	lock, e := readLock(path)
	if e != nil {
		t.Fatal(e)
	}
	skill := lock.Workspaces["github:acme/skills"].Skills["review"]
	for i, target := range skill.Targets {
		p, _ := targetPath(target, "review", project)
		os.RemoveAll(p)
		skill.Targets[i].PackageChecksum = "sha256:" + strings.Repeat("a", 64)
	}
	lock.Workspaces["github:acme/skills"].Skills["review"] = skill
	before, _ := json.MarshalIndent(lock, "", "  ")
	os.WriteFile(path, before, 0600)
	f.branch = installGitHubCommitB
	code, _, _ := invoke(t, "", "sync", "--frozen", "--project", project, "--json")
	if code != 5 {
		t.Fatal("checksum substitution accepted", code)
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("failed restore mutated lock")
	}
	for _, target := range skill.Targets {
		p, _ := targetPath(target, "review", project)
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatal("failed restore activated a target")
		}
	}
}
