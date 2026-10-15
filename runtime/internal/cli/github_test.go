package cli

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

type githubTestRoundTripper func(*http.Request) (*http.Response, error)

func (f githubTestRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func githubTestResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func githubTestJSON(status int, value any) *http.Response {
	b, _ := json.Marshal(value)
	return githubTestResponse(status, string(b))
}

func githubTestBlobSHA(data []byte) string {
	h := sha1.New()
	_, _ = h.Write([]byte("blob "))
	_, _ = h.Write([]byte(strconv.FormatInt(int64(len(data)), 10)))
	_, _ = h.Write([]byte{0})
	_, _ = h.Write(data)
	return hex.EncodeToString(h.Sum(nil))
}

func TestParseGitHubReference(t *testing.T) {
	ref := "v1.2"
	tests := []struct {
		name       string
		input      string
		explicit   string
		repository string
		path       string
		ref        *string
		tree       []string
	}{
		{name: "shorthand root", input: "github:acme/skills", repository: "acme/skills"},
		{name: "repository casing", input: "github:Acme/Skills", repository: "acme/skills"},
		{name: "shorthand root and ref", input: "github:acme/skills@v1.2", repository: "acme/skills", ref: &ref},
		{name: "shorthand path and ref", input: "github:acme/skills/review@v1.2", repository: "acme/skills", path: "review", ref: &ref},
		{name: "explicit root ref", input: "github:acme/skills", explicit: "feature/review", repository: "acme/skills", ref: stringPointer("feature/review")},
		{name: "URL root", input: "https://github.com/acme/skills", repository: "acme/skills"},
		{name: "URL tree", input: "https://github.com/acme/skills/tree/feature/review", repository: "acme/skills", tree: []string{"feature", "review"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseGitHubReference(tc.input, tc.explicit)
			if err != nil {
				t.Fatalf("parseGitHubReference() error = %v", err)
			}
			if got.Type != "github" || got.Repository != tc.repository || got.Path != tc.path {
				t.Fatalf("source identity = %#v", got)
			}
			if !sameStrings(got.treeParts, tc.tree) {
				t.Fatalf("tree parts = %#v, want %#v", got.treeParts, tc.tree)
			}
			if (got.Ref == nil) != (tc.ref == nil) || got.Ref != nil && *got.Ref != *tc.ref {
				t.Fatalf("ref = %v, want %v", got.Ref, tc.ref)
			}
		})
	}
	if !isGitHubReference("github:bad") || !isGitHubReference("https://github.com") {
		t.Fatal("malformed GitHub inputs should remain in the GitHub parser branch")
	}
	if isGitHubReference("https://github.example/acme/skills") {
		t.Fatal("untrusted host classified as GitHub")
	}
	for _, input := range []string{
		"github:acme/skills/review@",
		"github:acme/skills/../outside",
		"https://github.com/acme/skills/tree/main/../outside",
		"https://github.com/acme/skills/tree/main%2Freview",
	} {
		if _, err := parseGitHubReference(input, ""); err == nil {
			t.Errorf("parseGitHubReference(%q) accepted unsafe input", input)
		}
	}
	if _, err := parseGitHubReference("github:acme/skills/review@main", "other"); err == nil {
		t.Fatal("conflicting refs accepted")
	}
}

func TestGitHubResolveAndDownloadPinnedTree(t *testing.T) {
	commit := strings.Repeat("a", 40)
	packageTree := strings.Repeat("c", 40)
	skill := []byte("---\nname: review\ndescription: Review code\n---\nBody\n")
	script := []byte("#!/bin/sh\necho review\n")
	skillSHA := githubTestBlobSHA(skill)
	scriptSHA := githubTestBlobSHA(script)
	requests := []string{}
	r := newGitHubResolver()
	r.http.Transport = githubTestRoundTripper(func(req *http.Request) (*http.Response, error) {
		requests = append(requests, req.URL.String())
		if req.URL.Scheme != "https" || req.URL.Host != "api.github.com" {
			t.Fatalf("request escaped fixed API origin: %s", req.URL)
		}
		switch {
		case req.URL.Path == "/repos/acme/skills":
			return githubTestJSON(http.StatusOK, map[string]any{"private": false, "visibility": "public", "default_branch": "main"}), nil
		case req.URL.Path == "/repos/acme/skills/commits/main":
			return githubTestJSON(http.StatusOK, map[string]string{"sha": commit}), nil
		case req.URL.Path == "/repos/acme/skills/git/trees/"+commit:
			return githubTestJSON(http.StatusOK, map[string]any{"truncated": false, "tree": []any{
				map[string]any{"path": "review", "mode": "040000", "type": "tree", "sha": packageTree},
				map[string]any{"path": "unrelated-link", "mode": "120000", "type": "blob", "sha": strings.Repeat("1", 40)},
			}}), nil
		case req.URL.Path == "/repos/acme/skills/git/trees/"+packageTree:
			return githubTestJSON(http.StatusOK, map[string]any{"truncated": false, "tree": []any{
				map[string]any{"path": "SKILL.md", "mode": "100644", "type": "blob", "sha": skillSHA, "size": len(skill)},
				map[string]any{"path": "scripts", "mode": "040000", "type": "tree", "sha": strings.Repeat("f", 40)},
			}}), nil
		case req.URL.Path == "/repos/acme/skills/git/trees/"+strings.Repeat("f", 40):
			return githubTestJSON(http.StatusOK, map[string]any{"truncated": false, "tree": []any{
				map[string]any{"path": "run.sh", "mode": "100644", "type": "blob", "sha": scriptSHA, "size": len(script)},
			}}), nil
		case req.URL.Path == "/repos/acme/skills/git/blobs/"+skillSHA:
			return githubTestJSON(http.StatusOK, map[string]any{"encoding": "base64", "size": len(skill), "content": base64.StdEncoding.EncodeToString(skill)}), nil
		case req.URL.Path == "/repos/acme/skills/git/blobs/"+scriptSHA:
			return githubTestJSON(http.StatusOK, map[string]any{"encoding": "base64", "size": len(script), "content": base64.StdEncoding.EncodeToString(script)}), nil
		default:
			return githubTestResponse(http.StatusNotFound, "private response must never be exposed"), nil
		}
	})
	source, err := parseGitHubReference("github:acme/skills/review", "")
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := r.resolve(source)
	if err != nil {
		t.Fatalf("resolve() error = %v", err)
	}
	if resolved.Commit != commit || resolved.Ref != nil || resolved.Path != "review" {
		t.Fatalf("resolved source = %#v", resolved)
	}
	files, executables, err := r.download(resolved)
	if err != nil {
		t.Fatalf("download() error = %v", err)
	}
	if string(files["SKILL.md"]) != string(skill) || string(files["scripts/run.sh"]) != string(script) {
		t.Fatalf("downloaded files = %#v", files)
	}
	if len(executables) != 1 || executables[0] != "scripts/run.sh" {
		t.Fatalf("executables = %#v", executables)
	}
	for _, request := range requests {
		if strings.Contains(request, "private response") || strings.Contains(request, "GITHUB_TOKEN") {
			t.Fatalf("request leaked data: %s", request)
		}
	}
}

func TestGitHubTreeURLAmbiguityAndDefaultRef(t *testing.T) {
	commit := strings.Repeat("d", 40)
	r := newGitHubResolver()
	r.http.Transport = githubTestRoundTripper(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/repos/acme/skills":
			return githubTestJSON(http.StatusOK, map[string]any{"private": false, "visibility": "public", "default_branch": "main"}), nil
		case "/repos/acme/skills/commits/feature":
			return githubTestJSON(http.StatusOK, map[string]string{"sha": commit}), nil
		case "/repos/acme/skills/commits/feature/review":
			return githubTestJSON(http.StatusOK, map[string]string{"sha": commit}), nil
		default:
			return githubTestResponse(http.StatusNotFound, "secret response"), nil
		}
	})
	source, err := parseGitHubReference("https://github.com/acme/skills/tree/feature/review", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.resolve(source); githubCode(err) != 5 || !strings.Contains(err.Error(), "ambiguous") {
		t.Fatalf("ambiguous tree ref error = %v", err)
	}
	ref := "feature/review"
	source, err = parseGitHubReference("https://github.com/acme/skills/tree/feature/review", ref)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := r.resolve(source)
	if err != nil || resolved.Ref == nil || *resolved.Ref != ref || resolved.Path != "" || resolved.Commit != commit {
		t.Fatalf("explicit tree ref result = %#v, err=%v", resolved, err)
	}
}

func TestGitHubDownloadRejectsPrivateAndUnsafeEntries(t *testing.T) {
	commit := strings.Repeat("e", 40)
	tests := []struct {
		name string
		tree []githubTreeEntry
		code int
	}{
		{name: "symlink", tree: []githubTreeEntry{{Path: "link", Mode: "120000", Type: "blob", SHA: strings.Repeat("1", 40)}}, code: 5},
		{name: "submodule", tree: []githubTreeEntry{{Path: "dep", Mode: "160000", Type: "commit", SHA: strings.Repeat("1", 40)}}, code: 5},
		{name: "traversal", tree: []githubTreeEntry{{Path: "../SKILL.md", Mode: "100644", Type: "blob", SHA: strings.Repeat("1", 40), Size: 1}}, code: 5},
		{name: "case collision", tree: []githubTreeEntry{{Path: "SKILL.md", Mode: "100644", Type: "blob", SHA: strings.Repeat("1", 40), Size: 1}, {Path: "skill.md", Mode: "100644", Type: "blob", SHA: strings.Repeat("2", 40), Size: 1}}, code: 5},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := newGitHubResolver()
			r.http.Transport = githubTestRoundTripper(func(req *http.Request) (*http.Response, error) {
				switch req.URL.Path {
				case "/repos/acme/skills":
					return githubTestJSON(http.StatusOK, map[string]any{"private": false, "visibility": "public", "default_branch": "main"}), nil
				case "/repos/acme/skills/git/trees/" + commit:
					return githubTestJSON(http.StatusOK, map[string]any{"truncated": false, "tree": tc.tree}), nil
				default:
					return githubTestResponse(http.StatusNotFound, "secret"), nil
				}
			})
			_, _, err := r.download(githubSource{Type: "github", Repository: "acme/skills", Commit: commit})
			if githubCode(err) != tc.code {
				t.Fatalf("download error = %v (code %d), want %d", err, githubCode(err), tc.code)
			}
			if strings.Contains(err.Error(), "secret") {
				t.Fatalf("response body leaked in error: %v", err)
			}
		})
	}

	r := newGitHubResolver()
	r.http.Transport = githubTestRoundTripper(func(req *http.Request) (*http.Response, error) {
		return githubTestJSON(http.StatusOK, map[string]any{"private": true, "visibility": "private", "default_branch": "main"}), nil
	})
	_, _, err := r.download(githubSource{Type: "github", Repository: "acme/skills", Commit: commit})
	if githubCode(err) != 7 {
		t.Fatalf("private repository error = %v, code %d", err, githubCode(err))
	}
}

func TestGitHubRateLimitTokenAndResponseBounds(t *testing.T) {
	r := newGitHubResolver()
	r.token = "secret-token"
	calls := 0
	r.http.Transport = githubTestRoundTripper(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.URL.Scheme != "https" || req.URL.Host != "api.github.com" || req.Header.Get("Authorization") != "Bearer secret-token" {
			t.Fatalf("token escaped fixed API host: %s auth=%q", req.URL, req.Header.Get("Authorization"))
		}
		response := githubTestResponse(http.StatusTooManyRequests, "body must not leak")
		response.Header.Set("Retry-After", "9999")
		return response, nil
	})
	_, err := r.request(context.Background(), "/repos/acme/skills", githubRepositoryLimit)
	if githubCode(err) != 8 || calls != 1 || !strings.Contains(err.Error(), "9999 seconds") || strings.Contains(err.Error(), "body") || strings.Contains(err.Error(), "secret-token") {
		t.Fatalf("rate limit result = %v, calls=%d", err, calls)
	}
}

func TestGitHubDownloadLimitsAndMissingSkill(t *testing.T) {
	commit := strings.Repeat("7", 40)
	emptySHA := githubTestBlobSHA([]byte("README"))
	tests := []struct {
		name      string
		truncated bool
		entries   []githubTreeEntry
		blobs     map[string][]byte
		wantCode  int
	}{
		{
			name:      "truncated tree",
			truncated: true,
			wantCode:  5,
		},
		{
			name:     "oversized file",
			entries:  []githubTreeEntry{{Path: "SKILL.md", Mode: "100644", Type: "blob", SHA: strings.Repeat("8", 40), Size: maxFileBytes + 1}},
			wantCode: 5,
		},
		{
			name:     "missing SKILL",
			entries:  []githubTreeEntry{{Path: "README.md", Mode: "100644", Type: "blob", SHA: emptySHA, Size: int64(len("README"))}},
			blobs:    map[string][]byte{emptySHA: []byte("README")},
			wantCode: 5,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := newGitHubResolver()
			r.http.Transport = githubTestRoundTripper(func(req *http.Request) (*http.Response, error) {
				switch req.URL.Path {
				case "/repos/acme/skills":
					return githubTestJSON(http.StatusOK, map[string]any{"private": false, "visibility": "public", "default_branch": "main"}), nil
				case "/repos/acme/skills/git/trees/" + commit:
					return githubTestJSON(http.StatusOK, map[string]any{"truncated": tc.truncated, "tree": tc.entries}), nil
				}
				for sha, data := range tc.blobs {
					if req.URL.Path == "/repos/acme/skills/git/blobs/"+sha {
						return githubTestJSON(http.StatusOK, map[string]any{"encoding": "base64", "size": len(data), "content": base64.StdEncoding.EncodeToString(data)}), nil
					}
				}
				return githubTestResponse(http.StatusNotFound, "unavailable body"), nil
			})
			_, _, err := r.download(githubSource{Type: "github", Repository: "acme/skills", Commit: commit})
			if githubCode(err) != tc.wantCode {
				t.Fatalf("download error = %v (code %d), want %d", err, githubCode(err), tc.wantCode)
			}
		})
	}

	missingRef := newGitHubResolver()
	missingRef.http.Transport = githubTestRoundTripper(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/repos/acme/skills":
			return githubTestJSON(http.StatusOK, map[string]any{"private": false, "visibility": "public", "default_branch": "main"}), nil
		default:
			return githubTestResponse(http.StatusNotFound, "missing ref body"), nil
		}
	})
	source, err := parseGitHubReference("github:acme/skills@missing", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = missingRef.resolve(source); githubCode(err) != 4 {
		t.Fatalf("missing ref error = %v (code %d)", err, githubCode(err))
	}
}

func TestGitHubUnknownVisibilityFailsClosed(t *testing.T) {
	r := newGitHubResolver()
	r.http.Transport = githubTestRoundTripper(func(*http.Request) (*http.Response, error) {
		return githubTestJSON(http.StatusOK, map[string]any{"default_branch": "main"}), nil
	})
	_, _, err := r.download(githubSource{Type: "github", Repository: "acme/skills", Commit: strings.Repeat("a", 40)})
	if githubCode(err) != 7 {
		t.Fatal("unknown repository visibility accepted", err)
	}
}
