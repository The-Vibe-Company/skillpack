package cli

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDoctorShowsUserAndProjectPackagesAndMissingSecretPrerequisites(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("SKILLPACK_HOME", filepath.Join(home, "client"))
	t.Setenv("SKILLPACK_LEGACY_HOME", filepath.Join(home, "legacy"))
	t.Setenv("SKILLPACK_RUNTIME_HOME", filepath.Join(home, "runtime"))
	t.Setenv("SKILLPACK_API_KEY", "")
	t.Setenv("SKILLPACK_API_URL", "")
	t.Setenv("TEST_KEY", "")
	project := filepath.Join(home, "project")
	files := map[string][]byte{"SKILL.md": []byte("---\nname: notes\ndescription: Notes\n---\nBody\n"), "companion.json": []byte(`{"name":"notes","version":"1.0.0","environment":{"secrets":{"TEST_KEY":{"required":true}}},"database":{"tables":{"notes":{"audience":"organization","columns":{"body":{"type":"text"}}}}}}`)}
	_, hash, _ := canonicalPackage(files)
	for _, scope := range []string{"user", "project"} {
		root, err := toolRoot("codex", scope, project)
		if err != nil {
			t.Fatal(err)
		}
		target := filepath.Join(root, "notes")
		if err = writePackage(target, files); err != nil {
			t.Fatal(err)
		}
		lockPath := filepath.Join(home, "legacy", "skills.lock.json")
		stored := target
		if scope == "project" {
			lockPath = filepath.Join(project, ".companion", "skills.lock.json")
			stored, _ = filepath.Rel(project, target)
			stored = filepath.ToSlash(stored)
		}
		lock := installLock{Version: 2, Workspaces: map[string]workspaceLock{"org": {API: "https://example.test/v1", Skills: map[string]installedSkill{"notes": {Slug: "notes", Version: "1.0.0", Checksum: hash, Targets: []installedTarget{{Tool: "codex", Scope: scope, Path: stored, PackageChecksum: hash, Checksum: folderChecksum(files)}}}}}}}
		b, _ := json.Marshal(lock)
		os.MkdirAll(filepath.Dir(lockPath), 0700)
		os.WriteFile(lockPath, b, 0600)
	}
	code, out, diag := invoke(t, "", "doctor", "--project", project, "--json")
	if code != 0 {
		t.Fatalf("doctor %d %s %s", code, out, diag)
	}
	var result struct {
		Packages []struct {
			Scope         string `json:"scope"`
			Status        string `json:"status"`
			Prerequisites struct {
				Status   string   `json:"status"`
				Missing  []string `json:"missingSecrets"`
				Database string   `json:"database"`
			} `json:"runtimePrerequisites"`
		}
	}
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Packages) != 2 {
		t.Fatalf("user or project installation missing: %s", out)
	}
	for _, p := range result.Packages {
		if p.Status != "verified" || p.Prerequisites.Status != "missing_local_secrets" || len(p.Prerequisites.Missing) != 1 || p.Prerequisites.Database != "not_verified" {
			t.Fatalf("misleading prerequisites: %s", out)
		}
	}
	secretPath := filepath.Join(home, "legacy", "secrets", "org", "notes", ".env")
	os.MkdirAll(filepath.Dir(secretPath), 0700)
	os.WriteFile(secretPath, []byte("TEST_KEY=\"private-test-value\"\n"), 0600)
	code, out, diag = invoke(t, "", "doctor", "--project", project, "--json")
	if code != 0 || strings.Contains(out+diag, "private-test-value") || strings.Contains(out, "missing_local_secrets") {
		t.Fatalf("invalid private inspection: %d", code)
	}
	if !strings.Contains(out, `"database":"not_verified"`) {
		t.Fatal("offline doctor claimed remote database readiness")
	}
}
