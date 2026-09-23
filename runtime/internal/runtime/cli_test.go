package runtime

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunVersionPrintsPinnedVersion(t *testing.T) {
	var out, errOut bytes.Buffer
	code := Run([]string{"version"}, strings.NewReader(""), &out, &errOut)
	if code != 0 {
		t.Fatalf("version exited with %d: %s", code, errOut.String())
	}
	if got, want := out.String(), "skillpack-runtime "+RuntimeVersion+"\n"; got != want {
		t.Fatalf("version output = %q, want %q", got, want)
	}
}

func TestRuntimeVersionMatchesVersionFile(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "VERSION"))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(bytes.TrimSpace(data)); got != RuntimeVersion {
		t.Fatalf("RuntimeVersion=%q, VERSION=%q", RuntimeVersion, got)
	}
}
