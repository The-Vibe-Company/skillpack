package cli

import (
	"archive/tar"
	"compress/gzip"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// A generated response larger than both old repository caps, with only a tiny
// selected skill. Neither the fixture nor the downloader buffers the archive.
func TestGitHubInstallLargeRepositorySmallSkill(t *testing.T) {
	f, project := newInstallGitHubFixture(t)
	http.DefaultTransport = githubTestRoundTripper(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host != "codeload.github.com" {
			return f.RoundTrip(req)
		}
		reader, writer := io.Pipe()
		go func() { writer.CloseWithError(writeLargeGitHubRepository(writer, f.files[installGitHubCommitA])) }()
		return &http.Response{StatusCode: 200, Header: make(http.Header), ContentLength: -1, Body: reader}, nil
	})
	code, out, diag := installGitHubRun(t, project, "--tools", "codex", "--yes")
	if code != 0 {
		t.Fatalf("large repository install: code=%d out=%s diag=%s", code, out, diag)
	}
	data, err := os.ReadFile(filepath.Join(project, ".agents", "skills", "review", "SKILL.md"))
	if err != nil || string(data) != string(f.files[installGitHubCommitA]["SKILL.md"]) {
		t.Fatalf("selected skill: %q, %v", data, err)
	}
	if _, err := os.Stat(filepath.Join(project, ".agents", "skills", "review", "large-video.bin")); !os.IsNotExist(err) {
		t.Fatalf("unselected file installed: %v", err)
	}
}

func writeLargeGitHubRepository(out io.Writer, files map[string][]byte) error {
	gz, err := gzip.NewWriterLevel(out, gzip.NoCompression)
	if err != nil {
		return err
	}
	tw := tar.NewWriter(gz)
	const root = "skills-" + installGitHubCommitA + "/"
	// Store 257 MiB without compression so the response crosses the old 64 MiB
	// compressed and 256 MiB decompressed caps. Reuse one fixed-size chunk.
	if err := tw.WriteHeader(&tar.Header{Name: root + "large-video.bin", Mode: 0644, Size: 257 << 20}); err != nil {
		return err
	}
	var chunk [32 << 10]byte
	for remaining := int64(257 << 20); remaining > 0; remaining -= int64(len(chunk)) {
		if _, err := tw.Write(chunk[:]); err != nil {
			return err
		}
	}
	for name, data := range files {
		if err := tw.WriteHeader(&tar.Header{Name: root + "review/" + name, Mode: 0644, Size: int64(len(data))}); err != nil {
			return err
		}
		if _, err := tw.Write(data); err != nil {
			return err
		}
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return gz.Close()
}
