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

func TestAnonymousCatalogInstallPinsFrozenPackageAndRestores(t *testing.T) {
	home := t.TempDir()
	t.Setenv("SKILLPACK_HOME", filepath.Join(home, "client"))
	t.Setenv("SKILLPACK_RUNTIME_HOME", filepath.Join(home, "runtime"))
	// Even a configured credential must not be transmitted for catalog installs.
	t.Setenv("SKILLPACK_API_KEY", "cmp_pat_"+strings.Repeat("p", 48))
	files := map[string][]byte{"SKILL.md": []byte("---\nname: notes\ndescription: Published notes\n---\nFrozen body\n")}
	archive, _ := packageZip(files)
	_, hash, _ := canonicalPackage(files)
	available, tampered := true, false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("catalog request sent credentials")
		}
		if !available {
			w.WriteHeader(404)
			return
		}
		switch r.URL.Path {
		case "/v1/public/catalog/skills/example/notes":
			json.NewEncoder(w).Encode(map[string]any{"org_slug": "example", "skill_slug": "notes", "version": "1.0.0", "size_bytes": len(archive), "checksum": "sha256:" + digestBytes(archive)})
		case "/v1/public/catalog/skills/example/notes/versions/1.0.0/package":
			b := append([]byte(nil), archive...)
			if tampered {
				b[len(b)-1] ^= 1
			}
			w.Write(b)
		default:
			t.Errorf("catalog install requested unexpected/private path: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	t.Setenv("SKILLPACK_API_URL", server.URL)
	project := filepath.Join(home, "project")
	install := func(project string, extra ...string) int {
		args := []string{"install", "example/notes", "--scope", "project", "--project", project, "--tools", "codex", "--json"}
		code, out, diag := invoke(t, "", append(args, extra...)...)
		if code == 0 && !strings.Contains(out, "installed") {
			t.Fatalf("unexpected install result: %s %s", out, diag)
		}
		return code
	}
	if code := install(project); code != 0 {
		t.Fatalf("anonymous install failed: %d", code)
	}
	lock, err := readLock(filepath.Join(project, ".companion", "skills.lock.json"))
	if err != nil {
		t.Fatal(err)
	}
	skill := lock.Workspaces["catalog:example"].Skills["notes"]
	if skill.Version != "1.0.0" || skill.Pinned != "1.0.0" || skill.Checksum != hash {
		t.Fatalf("wrong frozen identity: %+v", skill)
	}
	got, err := os.ReadFile(filepath.Join(project, ".agents", "skills", "notes", "SKILL.md"))
	if err != nil || string(got) != string(files["SKILL.md"]) {
		t.Fatal("installed content differs from frozen package")
	}
	// Anonymous restore must use the catalog origin and reject a different package.
	for _, dir := range []string{".agents", ".codex"} {
		if err := os.RemoveAll(filepath.Join(project, dir, "skills", "notes")); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("SKILLPACK_API_KEY", "")
	code, out, diag := invoke(t, "", "sync", "--frozen", "--project", project, "--json")
	if code != 0 {
		t.Fatalf("anonymous frozen restore: %d %s %s", code, out, diag)
	}
	if code := install(filepath.Join(home, "version"), "--version", "2.0.0"); code == 0 {
		t.Fatal("arbitrary version accepted")
	}
	tampered = true
	if code := install(filepath.Join(home, "tampered")); code == 0 {
		t.Fatal("tampered ZIP accepted")
	}
	available = false
	if code := install(filepath.Join(home, "unlisted")); code != 4 {
		t.Fatalf("unavailable catalog returned %d", code)
	}
	code, _, _ = invoke(t, "", "install", "notes", "--scope", "project", "--project", filepath.Join(home, "private"), "--json")
	if code != 3 {
		t.Fatalf("plain slug did not require authentication: %d", code)
	}
}
