package cli

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestInterruptedTransactionHelper(t *testing.T) {
	root := os.Getenv("SKILLPACK_CRASH_TEST_ROOT")
	if root == "" {
		return
	}
	first, _ := stageFile(filepath.Join(root, "first"), []byte("new-first"), true)
	second, _ := stageFile(filepath.Join(root, "second"), []byte("new-second"), true)
	tx := transaction{State: "applying", Entries: []replacement{first, second}}
	b, _ := json.Marshal(tx)
	if err := writePrivate(filepath.Join(root, "transaction.json"), b); err != nil {
		os.Exit(20)
	}
	if err := os.Rename(first.Target, first.Backup); err != nil {
		os.Exit(21)
	}
	if err := os.Rename(first.Stage, first.Target); err != nil {
		os.Exit(22)
	}
	os.Exit(17)
}
func TestCrashRecoveryRestoresWholePackageProjectionPair(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "first"), []byte("old-first"), 0600)
	os.WriteFile(filepath.Join(root, "second"), []byte("old-second"), 0600)
	cmd := exec.Command(os.Args[0], "-test.run=^TestInterruptedTransactionHelper$")
	cmd.Env = append(os.Environ(), "SKILLPACK_CRASH_TEST_ROOT="+root)
	err := cmd.Run()
	if err == nil || cmd.ProcessState.ExitCode() != 17 {
		t.Fatalf("crash helper: %v", err)
	}
	a := app{home: root}
	if err = a.recoverTransaction(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"first", "second"} {
		b, _ := os.ReadFile(filepath.Join(root, name))
		if string(b) != "old-"+name {
			t.Fatalf("partial transaction survived for %s", name)
		}
	}
	if err = a.recoverTransaction(); err != nil {
		t.Fatal("recovery not idempotent", err)
	}
	entries, _ := os.ReadDir(root)
	if len(entries) != 2 {
		t.Fatal("staging material leaked", entries)
	}
}
func TestTransactionRejectsRedirectedAncestor(t *testing.T) {
	root := t.TempDir()
	inside := filepath.Join(root, "inside")
	os.Mkdir(inside, 0700)
	r, err := stageFile(filepath.Join(inside, "value"), []byte("private"), true)
	if err != nil {
		t.Fatal(err)
	}
	r.Root = root
	moved := filepath.Join(root, "moved")
	if err = os.Rename(inside, moved); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(moved, inside); err != nil {
		t.Skip("symlink unavailable", err)
	}
	a := app{home: root}
	if err = a.commitTransaction([]replacement{r}); err == nil {
		t.Fatal("redirected ancestor accepted")
	}
	if _, err = os.Stat(filepath.Join(moved, "value")); !os.IsNotExist(err) {
		t.Fatal("wrote through redirected ancestor")
	}
}
