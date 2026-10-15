package cli

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestGitHubInstallAPICallCount(t *testing.T) {
	for _, count := range []int{2, 1000} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			calls := 0
			archives := 0
			filesForArchive := map[string][]byte{}
			commit := strings.Repeat("a", 40)
			data := []byte("---\nname: measure\ndescription: Measure API calls\n---\nhello\n")
			sha := githubTestBlobSHA(data)
			entries := []githubTreeEntry{}
			for i := 0; i < count; i++ {
				name := fmt.Sprintf("file-%04d.txt", i)
				if i == 0 {
					name = "SKILL.md"
				}
				filesForArchive[name] = data
				entries = append(entries, githubTreeEntry{Path: name, Type: "blob", Mode: "100644", SHA: sha, Size: int64(len(data))})
			}
			r := newGitHubResolver()
			r.listRefs = func(context.Context, string, []string) (map[string]string, error) {
				return map[string]string{"HEAD": commit}, nil
			}
			r.http.Transport = githubTestRoundTripper(func(req *http.Request) (*http.Response, error) {
				if req.URL.Host == "codeload.github.com" {
					archives++
					return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(githubFixtureArchive(filesForArchive, "")))}, nil
				}
				calls++
				switch req.URL.Path {
				case "/repos/acme/skills":
					return githubTestJSON(200, map[string]any{"private": false, "visibility": "public", "default_branch": "main"}), nil
				case "/repos/acme/skills/git/trees/" + commit:
					return githubTestJSON(200, map[string]any{"tree": entries}), nil
				}
				return githubTestResponse(404, ""), nil
			})
			source, e := r.resolve(githubSource{Type: "github", Repository: "acme/skills"})
			if e != nil {
				t.Fatal(e)
			}
			files, _, e := r.download(source)
			if e != nil {
				t.Fatal(e)
			}
			if calls != 2 || archives != 1 || len(files) != count {
				t.Fatalf("files=%d API=%d codeload=%d", len(files), calls, archives)
			}
			t.Logf("files=%d api.github.com calls=%d codeload=%d", len(files), calls, archives)
		})
	}
}
