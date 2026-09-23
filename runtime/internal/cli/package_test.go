package cli

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"testing"
)

func TestNativePackageIdentityMatchesExistingPublishedFormat(t *testing.T) {
	b, err := os.ReadFile("testdata/canonical-package.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Files    map[string]string `json:"files"`
		Checksum string            `json:"checksum"`
	}
	if err = json.Unmarshal(b, &fixture); err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for name, body := range fixture.Files {
		files[name] = []byte(body)
	}
	_, checksum, err := canonicalPackage(files)
	if err != nil {
		t.Fatal(err)
	}
	if checksum != fixture.Checksum {
		t.Fatalf("native checksum %s differs from published TS oracle %s", checksum, fixture.Checksum)
	}
}

func TestArchiveRejectsTraversalAndPortableNameCollisions(t *testing.T) {
	for _, names := range [][]string{{"SKILL.md", "../outside"}, {"SKILL.md", "a.txt", "A.txt"}, {"SKILL.md", "con.txt"}, {"SKILL.md", "a", "a/b"}, {"SKILL.md", "references/café.md", "references/cafe\u0301.md"}} {
		var b bytes.Buffer
		z := zip.NewWriter(&b)
		for _, name := range names {
			w, err := z.Create(name)
			if err != nil {
				t.Fatal(err)
			}
			w.Write([]byte("fixture"))
		}
		z.Close()
		if _, err := readPackage(b.Bytes()); err == nil {
			t.Fatalf("unsafe archive accepted: %v", names)
		}
	}
}

func TestManagementBundleSatisfiesNativeInstaller(t *testing.T) {
	files, err := scanPackage("../../../packages/skillpack-skill/skill")
	if err != nil {
		t.Fatal(err)
	}
	if name, err := validatePackageKind(files, true); err != nil || name != "skillpack" {
		t.Fatalf("management bundle: %s %v", name, err)
	}
}
