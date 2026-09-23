package cli

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestConcurrentInstallChild(t *testing.T) {
	raw := os.Getenv("SKILLPACK_INSTALL_CHILD_ARGS")
	if raw == "" {
		return
	}
	var args []string
	if json.Unmarshal([]byte(raw), &args) != nil {
		os.Exit(30)
	}
	os.Exit(Run(args, strings.NewReader(""), os.Stdout, os.Stderr))
}

func TestInstallIncludesDependenciesAndFrozenCloneWorksWithoutCredentials(t *testing.T) {
	home := t.TempDir()
	t.Setenv("SKILLPACK_RUNTIME_HOME", filepath.Join(home, "runtime"))
	project := filepath.Join(home, "project")
	os.MkdirAll(project, 0755)
	t.Setenv("SKILLPACK_HOME", filepath.Join(home, "client"))
	t.Setenv("SKILLPACK_LEGACY_HOME", filepath.Join(home, "legacy"))
	t.Setenv("SKILLPACK_API_KEY", "cmp_pat_"+strings.Repeat("d", 48))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(r.URL.Path, "/")
		if r.URL.Path == "/v1/tokens/current" {
			w.Write([]byte(`{"user":{"id":"user"},"workspace":{"id":"org"},"token":{"id":"key"}}`))
			return
		}
		if len(parts) < 4 {
			w.WriteHeader(404)
			return
		}
		slug := parts[3]
		files := map[string][]byte{"SKILL.md": []byte(fmt.Sprintf("---\nname: %s\ndescription: Test skill\n---\nBody\n", slug))}
		_, hash, _ := canonicalPackage(files)
		switch {
		case strings.HasSuffix(r.URL.Path, "/dependencies"):
			if slug == "plan-pr" {
				w.Write([]byte(`{"requires":[{"slug":"tdd","status":"satisfied","can_open":true}]}`))
			} else {
				w.Write([]byte(`{"requires":[]}`))
			}
		case strings.HasSuffix(r.URL.Path, "/package"):
			b, _ := packageZip(files)
			w.Write(b)
		case strings.HasSuffix(r.URL.Path, "/install"):
			w.Write([]byte(`{"ok":true}`))
		default:
			json.NewEncoder(w).Encode(map[string]any{"id": "id-" + slug, "slug": slug, "current_version": "1.0.0", "checksum": hash})
		}
	}))
	defer server.Close()
	t.Setenv("SKILLPACK_API_URL", server.URL)
	code, out, diagnostic := invoke(t, "", "install", "plan-pr", "--scope", "project", "--project", project, "--tools", "codex,claude-code,opencode", "--json")
	if code != 0 {
		t.Fatalf("install: %d %s %s", code, out, diagnostic)
	}
	for _, root := range []string{".agents/skills", ".claude/skills", ".codex/skills"} {
		for _, slug := range []string{"plan-pr", "tdd"} {
			if _, err := os.Stat(filepath.Join(project, root, slug, "SKILL.md")); err != nil {
				t.Fatal(err)
			}
		}
	}
	// Two independent processes install different roots into the same project.
	// The shared project lock must retain both complete closures.
	children := []*exec.Cmd{}
	for _, slug := range []string{"concurrent-one", "concurrent-two"} {
		args, _ := json.Marshal([]string{"install", slug, "--scope", "project", "--project", project, "--tools", "codex", "--json"})
		child := exec.Command(os.Args[0], "-test.run=^TestConcurrentInstallChild$")
		child.Env = append(os.Environ(), "SKILLPACK_INSTALL_CHILD_ARGS="+string(args))
		if err := child.Start(); err != nil {
			t.Fatal(err)
		}
		children = append(children, child)
	}
	for _, child := range children {
		if err := child.Wait(); err != nil {
			t.Fatal("concurrent install failed", err)
		}
	}
	installed, err := readLock(filepath.Join(project, ".companion", "skills.lock.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, slug := range []string{"concurrent-one", "concurrent-two"} {
		if installed.Workspaces["org"].Skills[slug].Slug != slug {
			t.Fatal("concurrent root lost", slug)
		}
	}
	lock := filepath.Join(project, ".companion", "skills.lock.json")
	before, err := os.ReadFile(lock)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(before), home) {
		t.Fatal("project lock contains machine-specific paths")
	}
	t.Setenv("SKILLPACK_API_KEY", "")
	t.Setenv("SKILLPACK_API_URL", "")
	code, out, diagnostic = invoke(t, "", "sync", "--frozen", "--project", project, "--json")
	if code != 0 {
		t.Fatalf("offline sync: %d %s %s", code, out, diagnostic)
	}
	missing := filepath.Join(project, ".codex", "skills", "tdd")
	if err := os.RemoveAll(missing); err != nil {
		t.Fatal(err)
	}
	code, out, diagnostic = invoke(t, "", "sync", "--frozen", "--project", project, "--json")
	if code != 0 {
		t.Fatalf("offline restore: %d %s %s", code, out, diagnostic)
	}
	if _, err := os.Stat(filepath.Join(missing, "SKILL.md")); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(lock)
	if string(before) != string(after) {
		t.Fatal("frozen sync modified lock")
	}
	custom := filepath.Join(project, ".agents", "skills", "plan-pr", "SKILL.md")
	os.WriteFile(custom, []byte("user edit"), 0644)
	code, _, _ = invoke(t, "", "sync", "--frozen", "--project", project, "--json")
	if code == 0 {
		t.Fatal("frozen sync silently accepted drift")
	}
	kept, _ := os.ReadFile(custom)
	if string(kept) != "user edit" {
		t.Fatal("customized skill overwritten")
	}
}

func TestLockRoundTripPreservesOtherClientMetadata(t *testing.T) {
	path := filepath.Join(t.TempDir(), "skills.lock.json")
	original := `{"lockfileVersion":2,"customRoot":true,"workspaces":{"other":{"apiUrl":"https://example.com/v1","customWorkspace":"keep","skills":{"tdd":{"slug":"tdd","version":"1.0.0","companionSkillId":"immutable-id","targets":[{"tool":"codex","scope":"user","path":"/a","customTarget":42}]}}}}}`
	if err := os.WriteFile(path, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	lock, err := readLock(path)
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(lock)
	if err != nil {
		t.Fatal(err)
	}
	var v map[string]any
	json.Unmarshal(b, &v)
	w := v["workspaces"].(map[string]any)["other"].(map[string]any)
	s := w["skills"].(map[string]any)["tdd"].(map[string]any)
	if v["customRoot"] != true || w["customWorkspace"] != "keep" || s["companionSkillId"] != "immutable-id" || s["targets"].([]any)[0].(map[string]any)["customTarget"] != float64(42) {
		t.Fatalf("metadata lost: %s", b)
	}
}

func TestUpdateAllKeepsPinsAndReturnsFailuresPerSkill(t *testing.T) {
	home := t.TempDir()
	t.Setenv("SKILLPACK_RUNTIME_HOME", filepath.Join(home, "runtime"))
	project := filepath.Join(home, "project")
	t.Setenv("SKILLPACK_HOME", filepath.Join(home, "client"))
	t.Setenv("SKILLPACK_LEGACY_HOME", filepath.Join(home, "legacy"))
	t.Setenv("SKILLPACK_API_KEY", "cmp_pat_"+strings.Repeat("u", 48))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/tokens/current" {
			w.Write([]byte(`{"workspace":{"id":"org"},"user":{"id":"u"},"token":{"id":"key"}}`))
			return
		}
		w.WriteHeader(404)
	}))
	defer server.Close()
	t.Setenv("SKILLPACK_API_URL", server.URL)
	path := filepath.Join(project, ".companion", "skills.lock.json")
	os.MkdirAll(filepath.Dir(path), 0755)
	lock := installLock{Version: 2, Workspaces: map[string]workspaceLock{"org": {API: server.URL + "/v1", Skills: map[string]installedSkill{"pinned": {Slug: "pinned", Version: "1.0.0", Pinned: "1.0.0"}, "unavailable": {Slug: "unavailable", Version: "1.0.0"}}}}}
	b, _ := json.Marshal(lock)
	os.WriteFile(path, b, 0644)
	code, out, diagnostic := invoke(t, "", "update", "--all", "--scope", "project", "--project", project, "--json")
	if code == 0 || !strings.Contains(out, `"pinned"`) || !strings.Contains(out, `"failed"`) {
		t.Fatalf("inaccurate partial result: %d %s %s", code, out, diagnostic)
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(b) {
		t.Fatal("failed update rewrote lock")
	}
}
