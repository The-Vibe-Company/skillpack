//go:build !windows

package cli

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadConfigRestrictsExistingCredentialsBeforeUse(t *testing.T) {
	home := filepath.Join(t.TempDir(), "client")
	if err := os.Mkdir(home, 0755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(home, "client.json")
	data := []byte(`{"schemaVersion":1,"activeProfile":"default","profiles":{"default":{"apiUrl":"https://example.test/v1","apiKey":"synthetic-test-key"}}}`)
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(home, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	a := &app{home: home}
	cfg, err := a.loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Profiles["default"].Key == "" {
		t.Fatal("profile was not read")
	}
	for path, mode := range map[string]os.FileMode{home: 0700, path: 0600} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != mode {
			t.Fatalf("credential access not restricted: %s", info.Mode().Perm())
		}
	}
	link := filepath.Join(t.TempDir(), "linked-client")
	if err := os.Symlink(home, link); err != nil {
		t.Fatal(err)
	}
	a.home = link
	if _, err := a.loadConfig(); err == nil {
		t.Fatal("accepted a symbolic-link credential directory")
	}
}
