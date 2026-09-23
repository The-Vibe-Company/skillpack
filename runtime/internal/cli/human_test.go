package cli

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHumanHelpIsSpecificAndSuggestsMisspellings(t *testing.T) {
	code, out, diagnostic := invoke(t, "", "install", "--help")
	if code != 0 || !strings.Contains(out, "skillpack install") || !strings.Contains(out, "--scope") || strings.Contains(out, "auth login|status") {
		t.Fatalf("install help: %d %q %q", code, out, diagnostic)
	}
	code, _, diagnostic = invoke(t, "", "instal")
	if code != 2 || !strings.Contains(diagnostic, "install") {
		t.Fatalf("misspelled command: %d %q", code, diagnostic)
	}
}

func TestBrowserLoginRequiresVerifierAndKeepsKeyOutOfURL(t *testing.T) {
	t.Setenv("SKILLPACK_HOME", t.TempDir())
	t.Setenv("SKILLPACK_API_KEY", "")
	t.Setenv("SKILLPACK_API_URL", "")
	key := "cmp_pat_" + strings.Repeat("d", 48)
	var requestID, verifierHash string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/cli-login/start":
			var input struct {
				ID   string `json:"request_id"`
				Hash string `json:"verifier_hash"`
			}
			_ = json.NewDecoder(r.Body).Decode(&input)
			requestID, verifierHash = input.ID, input.Hash
			_ = json.NewEncoder(w).Encode(map[string]any{"verification_uri": server.URL + "/cli/approve?request_id=" + input.ID, "expires_in": 5, "interval": 1})
		case "/v1/cli-login/poll":
			var input struct {
				ID       string `json:"request_id"`
				Verifier string `json:"verifier"`
			}
			_ = json.NewDecoder(r.Body).Decode(&input)
			proof := sha256.Sum256([]byte(input.Verifier))
			if input.ID != requestID || hex.EncodeToString(proof[:]) != verifierHash {
				t.Error("invalid verifier exchange")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "approved", "token": key})
		case "/v1/tokens/current":
			if r.Header.Get("Authorization") != "Bearer "+key {
				t.Error("wrong bearer")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"user": map[string]string{"id": "user"}, "workspace": map[string]string{"id": "org"}, "token": map[string]string{"id": "token", "prefix": "cmp_pat_aaaa", "expires_at": "2099-01-01T00:00:00Z"}})
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	code, out, diagnostic := invoke(t, "", "auth", "login", "--api-url", server.URL, "--no-browser")
	if code != 0 || !strings.Contains(out, "Connected to ") {
		t.Fatalf("login: %d %q %q", code, out, diagnostic)
	}
	if strings.Contains(out+diagnostic, key) || !strings.Contains(diagnostic, "/cli/approve?") {
		t.Fatal("approval URL or key exposure is wrong")
	}
}

func TestHumanOutputAndMachineJSONStayDistinct(t *testing.T) {
	t.Setenv("SKILLPACK_HOME", t.TempDir())
	code, out, diagnostic := invoke(t, "", "auth", "logout")
	if code != 0 || strings.HasPrefix(strings.TrimSpace(out), "{") {
		t.Fatalf("human output: %d %q %q", code, out, diagnostic)
	}
	code, out, diagnostic = invoke(t, "", "auth", "logout", "--json")
	if code != 0 || !strings.HasPrefix(strings.TrimSpace(out), "{") {
		t.Fatalf("machine output: %d %q %q", code, out, diagnostic)
	}
}

func TestSkillListPrintsConciseTable(t *testing.T) {
	var out bytes.Buffer
	err := printHuman(&out, []string{"skills", "list"}, []any{map[string]any{"slug": "plan-pr", "current_version": "1.2.3", "scope": "org", "install_status": "update", "metadata": map[string]any{"unrelated": true}}})
	if err != nil || !strings.Contains(out.String(), "SLUG") || !strings.Contains(out.String(), "plan-pr") || strings.Contains(out.String(), "unrelated") {
		t.Fatalf("list table: %v %q", err, out.String())
	}
}

func TestEnvironmentKeyUsesProductionAPIWithoutSecondVariable(t *testing.T) {
	t.Setenv("SKILLPACK_HOME", t.TempDir())
	t.Setenv("SKILLPACK_API_URL", "")
	t.Setenv("SKILLPACK_API_KEY", "cmp_pat_"+strings.Repeat("e", 48))
	a := &app{options: options{values: map[string]string{}, flags: map[string]bool{}}, home: t.TempDir()}
	client, err := a.client()
	if err != nil || client.base != "https://skillpack.app/v1" {
		t.Fatalf("environment-only key: %v %#v", err, client)
	}
}
