package cli

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
)

const githubTarballTestCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

type githubTarballTestEntry struct {
	name string
	mode int64
	kind byte
	data []byte
	link string
	pax  map[string]string
}

func githubTarballTestArchive(t *testing.T, entries ...githubTarballTestEntry) []byte {
	t.Helper()
	var compressed bytes.Buffer
	gz := gzip.NewWriter(&compressed)
	tarWriter := tar.NewWriter(gz)
	for _, entry := range entries {
		header := &tar.Header{Name: entry.name, Mode: entry.mode, Typeflag: entry.kind, Linkname: entry.link}
		header.PAXRecords = entry.pax
		if entry.kind == tar.TypeReg || entry.kind == tar.TypeRegA || entry.kind == 0 {
			header.Size = int64(len(entry.data))
		}
		if err := tarWriter.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if len(entry.data) > 0 {
			if _, err := tarWriter.Write(entry.data); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return compressed.Bytes()
}

func githubTarballTestExpected(data []byte, mode string) map[string]githubTreeEntry {
	return map[string]githubTreeEntry{
		"SKILL.md": {
			Path: "review/SKILL.md", Mode: mode, Type: "blob",
			SHA: githubTestBlobSHA(data), Size: int64(len(data)),
		},
	}
}

func githubTarballTestResolver(t *testing.T, archive []byte, check func(*testing.T, *http.Request)) *githubResolver {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(archive)
	}))
	t.Cleanup(server.Close)
	serverURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	transport := githubTarballRoundTripperFunc(func(req *http.Request) (*http.Response, error) {
		if check != nil {
			check(t, req)
		}
		clone := req.Clone(req.Context())
		clone.URL.Scheme = serverURL.Scheme
		clone.URL.Host = serverURL.Host
		return http.DefaultTransport.RoundTrip(clone)
	})
	return &githubResolver{http: &http.Client{Transport: transport}}
}

type githubTarballRoundTripperFunc func(*http.Request) (*http.Response, error)

func (f githubTarballRoundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestGitHubTarballDownloadVerifiesSelectionAndIdentity(t *testing.T) {
	skill := []byte("---\nname: review\ndescription: fixture\n---\n")
	run := []byte("#!/bin/sh\nexit 0\n")
	archive := githubTarballTestArchive(t,
		githubTarballTestEntry{name: "pax_global_header", kind: tar.TypeXGlobalHeader, pax: map[string]string{"comment": githubTarballTestCommit}},
		githubTarballTestEntry{name: "skills-" + githubTarballTestCommit, mode: 0755, kind: tar.TypeDir},
		githubTarballTestEntry{name: "skills-" + githubTarballTestCommit + "/unrelated-link", mode: 0777, kind: tar.TypeSymlink, link: "../outside"},
		githubTarballTestEntry{name: "skills-" + githubTarballTestCommit + "/review", mode: 0755, kind: tar.TypeDir},
		githubTarballTestEntry{name: "skills-" + githubTarballTestCommit + "/review/SKILL.md", mode: 0644, kind: tar.TypeReg, data: skill},
		githubTarballTestEntry{name: "skills-" + githubTarballTestCommit + "/review/scripts/run.sh", mode: 0644, kind: tar.TypeReg, data: run},
	)
	expected := githubTarballTestExpected(skill, "100644")
	expected["scripts"] = githubTreeEntry{Path: "review/scripts", Mode: "040000", Type: "tree", SHA: strings.Repeat("b", 40)}
	expected["scripts/run.sh"] = githubTreeEntry{Path: "review/scripts/run.sh", Mode: "100755", Type: "blob", SHA: githubTestBlobSHA(run), Size: int64(len(run))}
	seen := false
	r := githubTarballTestResolver(t, archive, func(t *testing.T, req *http.Request) {
		seen = true
		if req.URL.Scheme != "https" || req.URL.Host != "codeload.github.com" || req.URL.Path != "/acme/skills/tar.gz/"+githubTarballTestCommit {
			t.Fatalf("unexpected codeload request: %s", req.URL)
		}
		if got := req.Header.Get("Authorization"); got != "" {
			t.Fatalf("authorization header leaked: %q", got)
		}
		if got := req.Header.Get("Cookie"); got != "" {
			t.Fatalf("cookie header leaked: %q", got)
		}
	})
	r.token = "secret-token"
	files, executable, err := r.downloadTarball(context.Background(), githubSource{Type: "github", Repository: "acme/skills", Path: "review", Commit: githubTarballTestCommit}, expected)
	if err != nil {
		t.Fatal(err)
	}
	if !seen || string(files["SKILL.md"]) != string(skill) || string(files["scripts/run.sh"]) != string(run) {
		t.Fatalf("unexpected downloaded files: seen=%v files=%v", seen, files)
	}
	if len(executable) != 1 || executable[0] != "scripts/run.sh" {
		t.Fatalf("unexpected executable warnings: %v", executable)
	}
}

func TestGitHubTarballAllowsOmittedDirectoriesAndRejectsUnsafeEntries(t *testing.T) {
	skill := []byte("---\nname: review\ndescription: fixture\n---\n")
	commit := githubTarballTestCommit
	expected := githubTarballTestExpected(skill, "100644")
	expected["scripts"] = githubTreeEntry{Path: "review/scripts", Mode: "040000", Type: "tree", SHA: strings.Repeat("b", 40)}
	expected["scripts/run.sh"] = githubTreeEntry{Path: "review/scripts/run.sh", Mode: "100644", Type: "blob", SHA: githubTestBlobSHA([]byte("ok")), Size: 2}
	tests := []struct {
		name    string
		entries []githubTarballTestEntry
	}{
		{name: "traversal", entries: []githubTarballTestEntry{{name: "repo-" + commit, mode: 0755, kind: tar.TypeDir}, {name: "repo-" + commit + "/review/../SKILL.md", mode: 0644, kind: tar.TypeReg, data: skill}}},
		{name: "backslash", entries: []githubTarballTestEntry{{name: "repo-" + commit, mode: 0755, kind: tar.TypeDir}, {name: "repo-" + commit + "/review\\SKILL.md", mode: 0644, kind: tar.TypeReg, data: skill}}},
		{name: "symlink outside selection", entries: []githubTarballTestEntry{{name: "repo-" + commit, mode: 0755, kind: tar.TypeDir}, {name: "repo-" + commit + "/.git/link", mode: 0777, kind: tar.TypeSymlink, link: "target"}}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			archive := githubTarballTestArchive(t, tc.entries...)
			r := githubTarballTestResolver(t, archive, nil)
			_, _, err := r.downloadTarball(context.Background(), githubSource{Type: "github", Repository: "acme/skills", Path: "review", Commit: commit}, expected)
			if githubCode(err) != 5 {
				t.Fatalf("error = %v, code %d", err, githubCode(err))
			}
		})
	}

	// No explicit package or scripts directory is required when the selected
	// regular files identify the same expected tree.
	archive := githubTarballTestArchive(t,
		githubTarballTestEntry{name: "repo-" + commit, mode: 0755, kind: tar.TypeDir},
		githubTarballTestEntry{name: "repo-" + commit + "/review/SKILL.md", mode: 0644, kind: tar.TypeReg, data: skill},
		githubTarballTestEntry{name: "repo-" + commit + "/review/scripts/run.sh", mode: 0644, kind: tar.TypeReg, data: []byte("ok")},
	)
	r := githubTarballTestResolver(t, archive, nil)
	if _, _, err := r.downloadTarball(context.Background(), githubSource{Type: "github", Repository: "acme/skills", Path: "review", Commit: commit}, expected); err != nil {
		t.Fatal(err)
	}
}

func TestGitHubTarballRejectsDuplicateChecksumAndMissingFiles(t *testing.T) {
	skill := []byte("---\nname: review\ndescription: fixture\n---\n")
	root := "repo-" + githubTarballTestCommit
	base := func(data []byte) []githubTarballTestEntry {
		return []githubTarballTestEntry{
			{name: root, mode: 0755, kind: tar.TypeDir},
			{name: root + "/review/SKILL.md", mode: 0644, kind: tar.TypeReg, data: data},
		}
	}
	expected := githubTarballTestExpected(skill, "100644")
	for _, tc := range []struct {
		name    string
		entries []githubTarballTestEntry
		want    string
	}{
		{name: "checksum", entries: base(bytes.Repeat([]byte{'x'}, len(skill))), want: "checksum"},
		{name: "missing", entries: []githubTarballTestEntry{{name: root, mode: 0755, kind: tar.TypeDir}}, want: "missing"},
		{name: "duplicate directory", entries: append(base(skill), githubTarballTestEntry{name: root + "/review/scripts", mode: 0755, kind: tar.TypeDir}, githubTarballTestEntry{name: root + "/review/scripts", mode: 0755, kind: tar.TypeDir}), want: "duplicate"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.name == "duplicate directory" {
				expected["scripts"] = githubTreeEntry{Path: "review/scripts", Mode: "040000", Type: "tree", SHA: strings.Repeat("b", 40)}
			}
			r := githubTarballTestResolver(t, githubTarballTestArchive(t, tc.entries...), nil)
			_, _, err := r.downloadTarball(context.Background(), githubSource{Type: "github", Repository: "acme/skills", Path: "review", Commit: githubTarballTestCommit}, expected)
			if githubCode(err) != 5 || !strings.Contains(strings.ToLower(err.Error()), tc.want) {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestGitHubTarballRejectsGzipChecksumTrailingRedirectAndLimits(t *testing.T) {
	skill := []byte("---\nname: review\ndescription: fixture\n---\n")
	root := "repo-" + githubTarballTestCommit
	expected := githubTarballTestExpected(skill, "100644")
	valid := githubTarballTestArchive(t,
		githubTarballTestEntry{name: root, mode: 0755, kind: tar.TypeDir},
		githubTarballTestEntry{name: root + "/review/SKILL.md", mode: 0644, kind: tar.TypeReg, data: skill},
	)
	corrupt := append([]byte(nil), valid...)
	corrupt[len(corrupt)-1] ^= 0xff
	for _, tc := range []struct {
		name string
		data []byte
		want string
	}{
		{name: "checksum", data: corrupt, want: "checksum"},
		{name: "compressed limit", data: valid, want: "compressed size"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := githubTarballTestResolver(t, tc.data, nil)
			compressedLimit := int64(len(valid) + 1)
			if tc.name == "compressed limit" {
				compressedLimit = int64(len(valid) - 1)
			}
			_, _, err := r.downloadTarballWithLimits(context.Background(), githubSource{Type: "github", Repository: "acme/skills", Path: "review", Commit: githubTarballTestCommit}, expected, compressedLimit, githubMaxDecompressedBytes)
			if githubCode(err) != 5 || !strings.Contains(strings.ToLower(err.Error()), tc.want) {
				t.Fatalf("error = %v", err)
			}
		})
	}

	// Insert bytes before gzip's trailer so they are decompressed after the tar
	// end blocks and cannot be mistaken for a second HTTP response.
	var uncompressed bytes.Buffer
	reader, err := gzip.NewReader(bytes.NewReader(valid))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = io.Copy(&uncompressed, reader); err != nil {
		t.Fatal(err)
	}
	_ = reader.Close()
	uncompressed.WriteString("trailing")
	var gz bytes.Buffer
	writer := gzip.NewWriter(&gz)
	_, _ = writer.Write(uncompressed.Bytes())
	_ = writer.Close()
	r := githubTarballTestResolver(t, gz.Bytes(), nil)
	_, _, err = r.downloadTarball(context.Background(), githubSource{Type: "github", Repository: "acme/skills", Path: "review", Commit: githubTarballTestCommit}, expected)
	if githubCode(err) != 5 || !strings.Contains(err.Error(), "trailing") {
		t.Fatalf("trailing error = %v", err)
	}
	var padded bytes.Buffer
	padded.Write(uncompressed.Bytes()[:len(uncompressed.Bytes())-len("trailing")])
	padded.Write(make([]byte, 1024))
	var paddedGzip bytes.Buffer
	paddedWriter := gzip.NewWriter(&paddedGzip)
	_, _ = paddedWriter.Write(padded.Bytes())
	_ = paddedWriter.Close()
	r = githubTarballTestResolver(t, paddedGzip.Bytes(), nil)
	if _, _, err = r.downloadTarball(context.Background(), githubSource{Type: "github", Repository: "acme/skills", Path: "review", Commit: githubTarballTestCommit}, expected); err != nil {
		t.Fatalf("zero padding rejected: %v", err)
	}

	redirectCalls := 0
	transport := githubTarballRoundTripperFunc(func(req *http.Request) (*http.Response, error) {
		redirectCalls++
		return &http.Response{StatusCode: http.StatusFound, Header: http.Header{"Location": []string{"https://example.test/secret"}}, Body: io.NopCloser(strings.NewReader("body")), Request: req}, nil
	})
	r = &githubResolver{http: &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return nil }}}
	_, _, err = r.downloadTarball(context.Background(), githubSource{Type: "github", Repository: "acme/skills", Path: "review", Commit: githubTarballTestCommit}, expected)
	if githubCode(err) != 8 || redirectCalls != 1 || strings.Contains(err.Error(), "secret") {
		t.Fatalf("redirect error = %v calls=%d", err, redirectCalls)
	}

	// A small decompressed cap fails while skipped/selected stream bytes are
	// being consumed, without allocating a full repository image.
	r = githubTarballTestResolver(t, valid, nil)
	_, _, err = r.downloadTarballWithLimits(context.Background(), githubSource{Type: "github", Repository: "acme/skills", Path: "review", Commit: githubTarballTestCommit}, expected, githubMaxCompressedBytes, 512)
	if githubCode(err) != 5 || !strings.Contains(strings.ToLower(err.Error()), "decompressed size") {
		t.Fatalf("decompressed limit error = %v", err)
	}
	skipped := githubTarballTestArchive(t,
		githubTarballTestEntry{name: root, mode: 0755, kind: tar.TypeDir},
		githubTarballTestEntry{name: root + "/outside/large.bin", mode: 0644, kind: tar.TypeReg, data: bytes.Repeat([]byte{'x'}, 2048)},
		githubTarballTestEntry{name: root + "/review/SKILL.md", mode: 0644, kind: tar.TypeReg, data: skill},
	)
	r = githubTarballTestResolver(t, skipped, nil)
	_, _, err = r.downloadTarballWithLimits(context.Background(), githubSource{Type: "github", Repository: "acme/skills", Path: "review", Commit: githubTarballTestCommit}, expected, githubMaxCompressedBytes, 1024)
	if githubCode(err) != 5 || !strings.Contains(strings.ToLower(err.Error()), "decompressed size") {
		t.Fatalf("skipped-file decompressed limit error = %v", err)
	}

}

func TestGitHubTarballRateLimitRetriesWithoutLeakingCredentials(t *testing.T) {
	skill := []byte("---\nname: review\ndescription: fixture\n---\n")
	root := "repo-" + githubTarballTestCommit
	archive := githubTarballTestArchive(t,
		githubTarballTestEntry{name: root, mode: 0755, kind: tar.TypeDir},
		githubTarballTestEntry{name: root + "/SKILL.md", mode: 0644, kind: tar.TypeReg, data: skill},
	)
	expected := map[string]githubTreeEntry{"SKILL.md": {Mode: "100644", Type: "blob", SHA: githubTestBlobSHA(skill), Size: int64(len(skill))}}
	calls := 0
	rt := githubTarballRoundTripperFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.Header.Get("Authorization") != "" || req.Header.Get("Cookie") != "" {
			t.Fatalf("credential header leaked")
		}
		if calls == 1 {
			return &http.Response{StatusCode: http.StatusTooManyRequests, Header: http.Header{"Retry-After": []string{"0"}}, Body: io.NopCloser(strings.NewReader("rate body")), Request: req}, nil
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(archive)), Request: req}, nil
	})
	r := &githubResolver{http: &http.Client{Transport: rt}, token: "secret-token"}
	if _, _, err := r.downloadTarball(context.Background(), githubSource{Type: "github", Repository: "acme/skills", Commit: githubTarballTestCommit}, expected); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("rate limit calls = %d, want 2", calls)
	}
}

func githubTarballTestParser(t *testing.T, name string, entry githubTreeEntry) *githubTarballParser {
	t.Helper()
	files, dirs, err := validateGitHubTarballExpected(map[string]githubTreeEntry{name: entry})
	if err != nil {
		t.Fatal(err)
	}
	return &githubTarballParser{
		sourcePath:       "review",
		commit:           githubTarballTestCommit,
		archiveRoot:      "repo-" + githubTarballTestCommit,
		packagePrefix:    "repo-" + githubTarballTestCommit + "/review",
		expectedFiles:    files,
		expectedDirs:     dirs,
		files:            map[string][]byte{},
		executables:      map[string]struct{}{},
		selectedPortable: portablePaths{},
		selectedEntries:  map[string]struct{}{},
		ancestorEntries:  map[string]struct{}{},
		expectedSeen:     map[string]struct{}{},
	}
}

func TestGitHubTarballChecksSelectedLimitsBeforeAllocation(t *testing.T) {
	emptySHA := githubTestBlobSHA(nil)
	tests := []struct {
		name      string
		rel       string
		size      int64
		count     int
		total     int64
		wantError string
	}{
		{name: "file limit", rel: "file.txt", size: 0, count: maxPackageFiles, wantError: "file limit"},
		{name: "per-file limit", rel: "file.txt", size: maxFileBytes + 1, wantError: "size limit"},
		{name: "total limit", rel: "file.txt", size: 1, total: maxPackageBytes, wantError: "size limit"},
		{name: "SKILL limit", rel: "SKILL.md", size: githubTarballSkillLimit + 1, wantError: "SKILL"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sha := emptySHA
			if tc.size > 0 {
				sha = strings.Repeat("a", 40)
			}
			p := githubTarballTestParser(t, tc.rel, githubTreeEntry{Mode: "100644", Type: "blob", SHA: sha, Size: tc.size})
			p.selectedCount = tc.count
			p.selectedTotal = tc.total
			err := p.entry(&tar.Header{Name: p.packagePrefix + "/" + tc.rel, Typeflag: tar.TypeReg, Mode: 0644, Size: tc.size}, strings.NewReader(""))
			if err == nil || githubCode(err) != 5 || !strings.Contains(err.Error(), tc.wantError) {
				t.Fatalf("error = %v", err)
			}
			if len(p.files) != 0 {
				t.Fatalf("oversized entry allocated file data")
			}
		})
	}
}

func TestGitHubTarballRejectsSelectedSpecialTypesAndExpectedCollisions(t *testing.T) {
	root := "repo-" + githubTarballTestCommit + "/review/"
	for _, kind := range []byte{tar.TypeSymlink, tar.TypeLink, tar.TypeFifo, tar.TypeChar, tar.TypeBlock, tar.TypeGNUSparse} {
		t.Run(strconv.Itoa(int(kind)), func(t *testing.T) {
			archive := githubTarballTestArchive(t,
				githubTarballTestEntry{name: "repo-" + githubTarballTestCommit, mode: 0755, kind: tar.TypeDir},
				githubTarballTestEntry{name: root + "special", mode: 0644, kind: kind, link: "../outside"},
			)
			r := githubTarballTestResolver(t, archive, nil)
			_, _, err := r.downloadTarball(context.Background(), githubSource{Type: "github", Repository: "acme/skills", Path: "review", Commit: githubTarballTestCommit}, map[string]githubTreeEntry{})
			if githubCode(err) != 5 {
				t.Fatalf("error = %v", err)
			}
		})
	}
	for _, entries := range []map[string]githubTreeEntry{
		{"A": {Mode: "100644", Type: "blob", SHA: strings.Repeat("a", 40), Size: 1}, "a": {Mode: "100644", Type: "blob", SHA: strings.Repeat("b", 40), Size: 1}},
		{"e\u0301": {Mode: "100644", Type: "blob", SHA: strings.Repeat("a", 40), Size: 1}, "é": {Mode: "100644", Type: "blob", SHA: strings.Repeat("b", 40), Size: 1}},
	} {
		if _, _, err := validateGitHubTarballExpected(entries); githubCode(err) != 5 {
			t.Fatalf("expected path collision accepted: %v", err)
		}
	}
}

type githubTarballFinalEOFReader struct{ reader *bytes.Reader }

func (r *githubTarballFinalEOFReader) Read(p []byte) (int, error) {
	n, e := r.reader.Read(p)
	if n > 0 && r.reader.Len() == 0 {
		return n, io.EOF
	}
	return n, e
}

func TestGitHubTarballRejectsFileAsSelectedRootAndFinalTrailingBytes(t *testing.T) {
	skill := []byte("---\nname: review\ndescription: fixture\n---\n")
	source := githubSource{Type: "github", Repository: "acme/skills", Path: "review", Commit: githubTarballTestCommit}
	root := "repo-" + githubTarballTestCommit
	archive := githubTarballTestArchive(t,
		githubTarballTestEntry{name: root, kind: tar.TypeDir, mode: 0755},
		githubTarballTestEntry{name: root + "/review", kind: tar.TypeReg, mode: 0644},
		githubTarballTestEntry{name: root + "/review/SKILL.md", kind: tar.TypeReg, mode: 0644, data: skill},
	)
	r := githubTarballTestResolver(t, archive, nil)
	if _, _, e := r.downloadTarball(context.Background(), source, githubTarballTestExpected(skill, "100644")); githubCode(e) != 5 || !strings.Contains(e.Error(), "not a directory") {
		t.Fatal("selected regular root accepted", e)
	}
	archive = githubTarballTestArchive(t,
		githubTarballTestEntry{name: root, kind: tar.TypeDir, mode: 0755},
		githubTarballTestEntry{name: root + "/review/SKILL.md", kind: tar.TypeReg, mode: 0644, data: skill},
	)
	archive = append(archive, []byte("unexpected trailing bytes")...)
	r = &githubResolver{http: &http.Client{Transport: githubTarballRoundTripperFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(&githubTarballFinalEOFReader{reader: bytes.NewReader(archive)})}, nil
	})}}
	if _, _, e := r.downloadTarball(context.Background(), source, githubTarballTestExpected(skill, "100644")); githubCode(e) != 5 || !strings.Contains(e.Error(), "trailing") {
		t.Fatal("final n+EOF trailing bytes accepted", e)
	}
}
