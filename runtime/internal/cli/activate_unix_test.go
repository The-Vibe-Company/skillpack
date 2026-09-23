//go:build !windows

package cli

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestNativeActivationRecoversReceiptAfterLauncherSwitch(t *testing.T) {
	home := t.TempDir()
	root := filepath.Join(home, "cli")
	old := filepath.Join(root, "versions", "0.2.0", "skillpack")
	next := filepath.Join(root, "versions", "0.3.0", "skillpack")
	for _, path := range []string{old, next} {
		os.MkdirAll(filepath.Dir(path), 0700)
		os.WriteFile(path, []byte("binary"), 0700)
	}
	launcher := filepath.Join(home, "skillpack")
	os.Symlink(next, launcher)
	receipt := filepath.Join(root, "install.json")
	previous, _ := json.Marshal(map[string]string{"executablePath": launcher, "binaryPath": old, "version": "0.2.0"})
	updated, _ := json.Marshal(map[string]string{"executablePath": launcher, "binaryPath": next, "version": "0.3.0"})
	os.WriteFile(receipt, previous, 0600)
	job, _ := json.Marshal(nativeActivation{launcher, next, receipt, updated})
	os.WriteFile(filepath.Join(root, "activation-receipt.json"), job, 0600)
	if err := recoverNativeActivation(home); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(receipt)
	if string(after) != string(updated) {
		t.Fatal("receipt did not recover")
	}
	if err := recoverNativeActivation(home); err != nil {
		t.Fatal("recovery not idempotent", err)
	}
	if _, err := os.Stat(old); err != nil {
		t.Fatal("rollback binary lost")
	}
}
func TestNativeActivationRejectsUnmanagedLauncher(t *testing.T) {
	home := t.TempDir()
	launcher := filepath.Join(home, "skillpack")
	os.WriteFile(launcher, []byte("user binary"), 0700)
	if _, err := activateNative(launcher, filepath.Join(home, "next"), filepath.Join(home, "cli", "install.json"), []byte(`{}`)); err == nil {
		t.Fatal("unmanaged binary replaced")
	}
	b, _ := os.ReadFile(launcher)
	if string(b) != "user binary" {
		t.Fatal("user binary changed")
	}
}
