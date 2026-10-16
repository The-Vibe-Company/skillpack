package cli

import (
	"bytes"
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestGitHubSkillLimitConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name, bytes, files string
		flags              map[string]string
		wantBytes          int64
		wantFiles, code    int
	}{
		{name: "defaults", wantBytes: maxPackageBytes, wantFiles: maxPackageFiles},
		{name: "environment", bytes: "42", files: "3", wantBytes: 42, wantFiles: 3},
		{name: "flags override environment", bytes: "bad", files: "bad", flags: map[string]string{"max-skill-size": "100", "max-skill-files": "4"}, wantBytes: 100, wantFiles: 4},
		{name: "zero bytes", bytes: "0", code: 2},
		{name: "negative bytes", bytes: "-1", code: 2},
		{name: "bytes overflow", bytes: "999999999999999999999", code: 2},
		{name: "bytes above hard cap", bytes: strconv.FormatInt(githubMaxDecompressedBytes+1, 10), code: 2},
		{name: "invalid files", files: "bad", code: 2},
		{name: "negative files", files: "-1", code: 2},
		{name: "zero files", files: "0", code: 2},
		{name: "files above tree cap", files: strconv.Itoa(githubMaxTreeEntries + 1), code: 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SKILLPACK_MAX_SKILL_BYTES", tc.bytes)
			t.Setenv("SKILLPACK_MAX_SKILL_FILES", tc.files)
			l, err := (options{values: tc.flags}).githubLimits()
			if (err != nil) != (tc.code != 0) || err != nil && githubCode(err) != tc.code {
				t.Fatalf("limits=%+v error=%v", l, err)
			}
			if err == nil && (l.bytes != tc.wantBytes || l.files != tc.wantFiles) {
				t.Fatalf("limits=%+v", l)
			}
		})
	}
}

func TestGitHubInstallSkillLimitsBeforeDownload(t *testing.T) {
	for _, tc := range []struct {
		name                string
		args                []string
		env, value, message string
	}{
		{name: "bytes env", env: "SKILLPACK_MAX_SKILL_BYTES", value: "1", message: "--max-skill-size"},
		{name: "files env", env: "SKILLPACK_MAX_SKILL_FILES", value: "1", message: "--max-skill-files"},
		{name: "bytes flag", args: []string{"--max-skill-size", "1"}, message: "SKILLPACK_MAX_SKILL_BYTES"},
		{name: "files flag", args: []string{"--max-skill-files", "1"}, message: "SKILLPACK_MAX_SKILL_FILES"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f, project := newInstallGitHubFixture(t)
			t.Setenv("SKILLPACK_MAX_SKILL_BYTES", "")
			t.Setenv("SKILLPACK_MAX_SKILL_FILES", "")
			if tc.env != "" {
				t.Setenv(tc.env, tc.value)
			}
			code, _, diag := installGitHubRun(t, project, append([]string{"--yes"}, tc.args...)...)
			if code != 5 || !strings.Contains(diag, tc.message) || !strings.Contains(diag, "limit (1") {
				t.Fatalf("code=%d diag=%s", code, diag)
			}
			if len(f.archives) != 0 {
				t.Fatal("downloaded despite selected tree limit")
			}
			if _, err := os.Stat(filepath.Join(project, ".companion", "skills.lock.json")); !os.IsNotExist(err) {
				t.Fatalf("lock written on failure: %v", err)
			}
		})
	}
}

func TestGitHubTarballConfiguredSelectedLimits(t *testing.T) {
	skill := []byte("---\nname: review\ndescription: fixture\n---\n")
	archive := githubFixtureArchive(map[string][]byte{"SKILL.md": skill, "extra.txt": []byte("x")}, "review")
	expected := githubTarballTestExpected(skill, "100644")
	expected["extra.txt"] = githubTreeEntry{Mode: "100644", Type: "blob", Size: 1, SHA: githubTestBlobSHA([]byte("x"))}
	for _, tc := range []struct {
		name    string
		limits  githubSkillLimits
		message string
	}{
		{name: "bytes", limits: githubSkillLimits{bytes: int64(len(skill)), files: 2}, message: "--max-skill-size"},
		{name: "files", limits: githubSkillLimits{bytes: 1000, files: 1}, message: "--max-skill-files"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := githubTarballTestResolver(t, archive, nil)
			r.limits = tc.limits
			files, _, err := r.downloadTarball(context.Background(), githubSource{Type: "github", Repository: "acme/skills", Path: "review", Commit: installGitHubCommitA}, expected)
			if githubCode(err) != 5 || !strings.Contains(err.Error(), tc.message) || files != nil {
				t.Fatalf("files=%v err=%v", files, err)
			}
		})
	}
}

func TestGitHubRaisedLimitsInstallUpdateAndFrozenRestore(t *testing.T) {
	f, project := newInstallGitHubFixture(t)
	// Exceed the former fixed selected-package cap, including its per-file cap.
	f.files[installGitHubCommitA]["asset.bin"] = make([]byte, 26<<20)
	f.files[installGitHubCommitB]["asset.bin"] = f.files[installGitHubCommitA]["asset.bin"]
	t.Setenv("SKILLPACK_MAX_SKILL_BYTES", "")
	t.Setenv("SKILLPACK_MAX_SKILL_FILES", "")
	if code, _, diag := installGitHubRun(t, project, "--yes"); code != 5 || !strings.Contains(diag, "26214400 bytes") {
		t.Fatalf("default limit: %d %s", code, diag)
	}
	t.Setenv("SKILLPACK_MAX_SKILL_BYTES", strconv.Itoa(32<<20))
	t.Setenv("SKILLPACK_MAX_SKILL_FILES", "1")
	if code, _, diag := installGitHubRun(t, project, "--yes", "--tools", "codex", "--max-skill-files", "3"); code != 0 {
		t.Fatalf("raised limits: %d %s", code, diag)
	}
	syncArgs := []string{"sync", "--frozen", "--project", project, "--json", "--max-skill-files", "3"}
	f.offline = true
	if code, _, diag := invoke(t, "", syncArgs...); code != 0 {
		t.Fatalf("offline verify: %d %s", code, diag)
	}
	f.offline = false
	target := filepath.Join(project, ".agents", "skills", "review")
	if err := os.RemoveAll(target); err != nil {
		t.Fatal(err)
	}
	if code, _, diag := invoke(t, "", syncArgs...); code != 0 {
		t.Fatalf("frozen restore: %d %s", code, diag)
	}
	f.branch = installGitHubCommitB
	if code, _, diag := invoke(t, "", "update", "github:acme/skills/review", "--scope", "project", "--project", project, "--yes", "--json", "--max-skill-size", strconv.Itoa(32<<20), "--max-skill-files", "3"); code != 0 {
		t.Fatalf("update: %d %s", code, diag)
	}
	data, err := os.ReadFile(filepath.Join(target, "SKILL.md"))
	if err != nil || !strings.Contains(string(data), installGitHubCommitB) {
		t.Fatalf("updated data=%q err=%v", data, err)
	}
}

// Enforce repository caps even on chunked responses without Content-Length,
// including when the decompressed cap is hit inside a selected file's payload.
func TestGitHubTarballStreamHardCapsCloseResponse(t *testing.T) {
	skill := []byte("---\nname: review\ndescription: fixture\n---\n")
	archive := githubFixtureArchive(map[string][]byte{"SKILL.md": skill}, "review")
	for _, tc := range []struct {
		name                     string
		compressed, decompressed int64
		want                     string
	}{
		{name: "compressed", compressed: int64(len(archive) - 1), decompressed: githubMaxDecompressedBytes, want: "compressed size limit (" + strconv.Itoa(len(archive)-1) + " bytes"},
		{name: "selected payload", compressed: githubMaxCompressedBytes, decompressed: 512 + int64(len(skill)) - 1, want: "decompressed size limit (" + strconv.Itoa(512+len(skill)-1) + " bytes"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := &githubLimitTestBody{Reader: bytes.NewReader(archive)}
			r := &githubResolver{http: &http.Client{Transport: githubTestRoundTripper(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, Header: make(http.Header), ContentLength: -1, Body: body}, nil
			})}}
			files, _, err := r.downloadTarballWithLimits(context.Background(), githubSource{Type: "github", Repository: "acme/skills", Path: "review", Commit: installGitHubCommitA}, githubTarballTestExpected(skill, "100644"), tc.compressed, tc.decompressed)
			if githubCode(err) != 5 || !strings.Contains(err.Error(), tc.want) || !strings.Contains(err.Error(), "smaller repository") || files != nil {
				t.Fatalf("files=%v err=%v", files, err)
			}
			if !body.closed || body.read > tc.compressed+1 {
				t.Fatalf("closed=%v bytes read=%d", body.closed, body.read)
			}
		})
	}
}

type githubLimitTestBody struct {
	*bytes.Reader
	closed bool
	read   int64
}

func (b *githubLimitTestBody) Close() error { b.closed = true; return nil }
func (b *githubLimitTestBody) Read(p []byte) (int, error) {
	n, err := b.Reader.Read(p)
	b.read += int64(n)
	return n, err
}
