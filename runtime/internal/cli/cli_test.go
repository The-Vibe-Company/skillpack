package cli

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func invoke(t *testing.T, input string, args ...string) (int, string, string) {
	t.Helper()
	var out, diagnostic bytes.Buffer
	code := Run(args, strings.NewReader(input), &out, &diagnostic)
	return code, out.String(), diagnostic.String()
}

// Login is exercised at the command boundary against an HTTP peer. Server authority is
// independently covered by API integration tests; this observes client persistence and output.
func TestLoginPersistsKeyPrivatelyAndReusesItWithoutLeaking(t *testing.T) {
	home := t.TempDir()
	t.Setenv("SKILLPACK_HOME", home)
	t.Setenv("SKILLPACK_API_KEY", "")
	t.Setenv("SKILLPACK_API_URL", "")
	key := "cmp_pat_" + strings.Repeat("a", 48)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+key {
			t.Errorf("missing key authorization")
			w.WriteHeader(401)
			return
		}
		if r.URL.Path == "/v1/tokens/current" {
			json.NewEncoder(w).Encode(map[string]any{"user": map[string]any{"id": "user-1"}, "workspace": map[string]any{"id": "org-1"}, "token": map[string]any{"id": "key-1", "prefix": "cmp_pat_aaaa", "scopes": []string{"skills:read", "skills:write", "secrets:read", "secrets:write", "database:read", "database:write"}, "expires_at": "2099-01-01T00:00:00Z"}})
			return
		}
		if r.URL.Path != "/v1/skills" {
			t.Errorf("unexpected endpoint %s", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		w.Write([]byte(`[{"slug":"plan-pr"}]`))
	}))
	defer server.Close()
	code, out, diagnostic := invoke(t, key+"\n", "auth", "login", "--api-url", server.URL, "--token-stdin", "--json")
	if code != 0 {
		t.Fatalf("login: %d %s %s", code, out, diagnostic)
	}
	if strings.Contains(out+diagnostic, key) {
		t.Fatal("plaintext key exposed")
	}
	info, err := os.Stat(filepath.Join(home, "client.json"))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		t.Fatal("credentials readable by others")
	}
	code, out, diagnostic = invoke(t, "", "skills", "list", "--json")
	if code != 0 || !strings.Contains(out, `"plan-pr"`) {
		t.Fatalf("persistent login: %d %s %s", code, out, diagnostic)
	}
	if strings.Contains(out+diagnostic, key) {
		t.Fatal("key exposed")
	}
}

func TestAPIKeyCallsDatabaseButNeverPrintsGrantOrForwardsToOtherOrigin(t *testing.T) {
	t.Setenv("SKILLPACK_HOME", t.TempDir())
	t.Setenv("SKILLPACK_API_KEY", "cmp_pat_"+strings.Repeat("b", 48))
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != "POST" || r.URL.Path != "/v1/skills/notes/database/query" {
			t.Errorf("unexpected operation %s %s", r.Method, r.URL.Path)
		}
		w.Write([]byte(`{"rows":[["saved note"]]}`))
	}))
	defer server.Close()
	t.Setenv("SKILLPACK_API_URL", server.URL)
	code, out, diagnostic := invoke(t, `{"sql":"SELECT body FROM notes"}`, "api", "POST", "/v1/skills/notes/database/query", "--input", "-")
	if code != 0 || !strings.Contains(out, "saved note") {
		t.Fatalf("query: %d %s %s", code, out, diagnostic)
	}
	for _, path := range []string{"/v1/secret-grants/redeem", "/v1/secret-retrievals/plan/grant", "/v1/tokens", "https://other.example/v1/skills", "/v1/skills/../tokens", "/v1/skills/%2e%2e/tokens"} {
		code, _, _ := invoke(t, `{}`, "api", "POST", path, "--input", "-")
		if code == 0 {
			t.Errorf("unsafe generic route accepted %s", path)
		}
	}
	if requests != 1 {
		t.Fatalf("forbidden operations made %d requests", requests)
	}
}

func TestSecretsSyncProjectsValuesPrivatelyWithoutPrintingThem(t *testing.T) {
	home := t.TempDir()
	t.Setenv("SKILLPACK_HOME", filepath.Join(home, "client"))
	t.Setenv("SKILLPACK_LEGACY_HOME", filepath.Join(home, "legacy"))
	t.Setenv("SKILLPACK_API_KEY", "cmp_pat_"+strings.Repeat("c", 48))
	secret := "test-value-with-\"quote\"\nline"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/tokens/current":
			w.Write([]byte(`{"user":{"id":"user"},"workspace":{"id":"org"},"token":{"id":"key"}}`))
		case "/v1/secret-retrievals/preflight":
			w.Write([]byte(`{"plan_id":"plan","operation_id":"operation","blockers":0,"items":[{"projection_id":"projection","skill":"notes","env_key":"TEST_KEY","status":"personal","required":true}]}`))
		case "/v1/secret-retrievals/plan/grant":
			w.Write([]byte(`{"grant":"cmp_grant_test"}`))
		case "/v1/secret-grants/redeem":
			json.NewEncoder(w).Encode(map[string]any{"operation_id": "operation", "items": []any{map[string]any{"projection_id": "projection", "skill": "notes", "env_key": "TEST_KEY", "value": secret}}})
		default:
			t.Errorf("unexpected endpoint %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	t.Setenv("SKILLPACK_API_URL", server.URL)
	code, out, diagnostic := invoke(t, "", "secrets", "sync", "notes", "--confirm-secrets", "--json")
	if code != 0 {
		t.Fatalf("sync: %d %s %s", code, out, diagnostic)
	}
	if strings.Contains(out+diagnostic, "test-value") || strings.Contains(out+diagnostic, "cmp_grant_") {
		t.Fatal("sensitive material printed")
	}
	b, err := os.ReadFile(filepath.Join(home, "legacy", "secrets", "org", "notes", ".env"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "TEST_KEY=\"test-value-with-\\\"quote\\\"\\nline\"\n" {
		t.Fatalf("incorrect projection %q", b)
	}
	state, err := os.ReadFile(filepath.Join(home, "legacy", "secrets", "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(state), secret) || !strings.Contains(string(state), "projectionId") {
		t.Fatalf("invalid projection metadata: %s", state)
	}

}
