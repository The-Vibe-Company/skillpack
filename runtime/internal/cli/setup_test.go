package cli

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSetupPreservesUnrelatedHooksAndDoesNotApproveCodex(t *testing.T) {
	home := t.TempDir()
	codex := filepath.Join(home, "codex")
	os.MkdirAll(codex, 0700)
	t.Setenv("SKILLPACK_HOME", filepath.Join(home, "client"))
	t.Setenv("SKILLPACK_RUNTIME_HOME", filepath.Join(home, "runtime"))
	t.Setenv("CODEX_HOME", codex)
	t.Setenv("SKILLPACK_LEGACY_HOME", filepath.Join(home, "legacy"))
	original := `{"custom":true,"hooks":{"PostToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"echo keep"}]}]}}`
	path := filepath.Join(codex, "hooks.json")
	os.WriteFile(path, []byte(original), 0600)
	for i := 0; i < 2; i++ {
		code, out, err := invoke(t, "", "setup", "--tools", "codex", "--json")
		if code != 0 {
			t.Fatalf("setup: %d %s %s", code, out, err)
		}
		if !strings.Contains(out, "requires_host_approval") {
			t.Fatal(out)
		}
	}
	b, _ := os.ReadFile(path)
	var hooks map[string]any
	json.Unmarshal(b, &hooks)
	if hooks["custom"] != true || strings.Count(string(b), "echo keep") != 1 || strings.Count(string(b), "Skillpack runtime") != 5 || strings.Contains(string(b), "python") {
		t.Fatalf("hooks damaged: %s", b)
	}
	if _, err := os.Stat(filepath.Join(codex, "config.toml")); !os.IsNotExist(err) {
		t.Fatal("setup wrote host trust configuration")
	}
}
