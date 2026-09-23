package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImportLegacyExportPreservesOriginalAndPins(t *testing.T) {
	home := t.TempDir()
	t.Setenv("SKILLPACK_HOME", filepath.Join(home, "client"))
	t.Setenv("SKILLPACK_RUNTIME_HOME", filepath.Join(home, "runtime"))
	project := filepath.Join(home, "project")
	files := map[string][]byte{"SKILL.md": []byte("---\nname: notes\ndescription: Test notes\n---\nBody\n")}
	old := filepath.Join(project, "legacy", "notes")
	if err := writePackage(old, files); err != nil {
		t.Fatal(err)
	}
	_, hash, _ := canonicalPackage(files)
	legacy := map[string]any{"lockfileVersion": 1, "registry": map[string]any{"url": "https://example.test/v1", "orgId": "org"}, "skills": map[string]any{"notes": map[string]any{"name": "notes", "resolved": "1.0.0", "checksum": hash, "pinned": "1.0.0", "installPath": "legacy/notes"}}}
	body, _ := json.Marshal(legacy)
	source := filepath.Join(project, "companion.lock")
	if err := os.WriteFile(source, body, 0600); err != nil {
		t.Fatal(err)
	}
	code, out, diag := invoke(t, "", "import-lock", source, "--project", project, "--tools", "codex,claude-code", "--json")
	if code != 0 {
		t.Fatalf("import: %d %s %s", code, out, diag)
	}
	after, _ := os.ReadFile(source)
	if string(after) != string(body) {
		t.Fatal("source export changed")
	}
	for _, rel := range []string{"legacy/notes/SKILL.md", ".agents/skills/notes/SKILL.md", ".codex/skills/notes/SKILL.md", ".claude/skills/notes/SKILL.md"} {
		b, err := os.ReadFile(filepath.Join(project, rel))
		if err != nil || string(b) != string(files["SKILL.md"]) {
			t.Fatalf("package missing or altered %s: %v", rel, err)
		}
	}
	lock, err := readLock(filepath.Join(project, ".companion", "skills.lock.json"))
	if err != nil {
		t.Fatal(err)
	}
	if lock.Workspaces["org"].Skills["notes"].Pinned != "1.0.0" {
		t.Fatal("pin lost")
	}
	code, _, _ = invoke(t, "", "sync", "--frozen", "--project", project, "--json")
	if code != 0 {
		t.Fatal("imported installation cannot restore offline")
	}
}

func TestPublicInstallDoesNotRequestPrivateDependenciesAndRejectsChangedRelease(t *testing.T) {
	home := t.TempDir()
	t.Setenv("SKILLPACK_HOME", filepath.Join(home, "client"))
	t.Setenv("SKILLPACK_RUNTIME_HOME", filepath.Join(home, "runtime"))
	t.Setenv("SKILLPACK_API_KEY", "cmp_pat_"+strings.Repeat("p", 48))
	files := map[string][]byte{"SKILL.md": []byte("---\nname: public-notes\ndescription: Public notes\n---\nBody\n")}
	archive, _ := packageZip(files)
	modified := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/tokens/current":
			w.Write([]byte(`{"workspace":{"id":"org"},"user":{"id":"u"},"token":{"id":"key"}}`))
		case "/v1/public/skills/share":
			json.NewEncoder(w).Encode(map[string]any{"slug": "public-notes", "public_release": map[string]any{"version": "1.0.0", "size_bytes": len(archive), "checksum": "sha256:" + digestBytes(archive)}})
		case "/v1/public/skills/share/versions/1.0.0/package":
			b := append([]byte(nil), archive...)
			if modified {
				b[len(b)-1] ^= 1
			}
			w.Write(b)
		default:
			t.Errorf("public install requested private operation: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	t.Setenv("SKILLPACK_API_URL", server.URL)
	project := filepath.Join(home, "project")
	code, out, diag := invoke(t, "", "install", "--public", "share", "--version", "1.0.0", "--scope", "project", "--project", project, "--tools", "codex", "--json")
	if code != 0 {
		t.Fatalf("public install: %d %s %s", code, out, diag)
	}
	modified = true
	other := filepath.Join(home, "tampered")
	code, _, _ = invoke(t, "", "install", "--public", "share", "--version", "1.0.0", "--scope", "project", "--project", other, "--tools", "codex", "--json")
	if code == 0 {
		t.Fatal("modified public archive accepted")
	}
	if _, err := os.Stat(filepath.Join(other, ".agents", "skills", "public-notes")); !os.IsNotExist(err) {
		t.Fatal("invalid archive activated")
	}
}
