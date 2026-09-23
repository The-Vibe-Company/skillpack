package cli

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

func randomHex(size int) (string, error) {
	b := make([]byte, size)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func openBrowser(target string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", target)
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", target)
	default:
		command = exec.Command("xdg-open", target)
	}
	return command.Start()
}

func publicJSON(base, path string, body any, destination any) (int, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return 0, fail(8, "could not encode authorization request")
	}
	req, err := http.NewRequest("POST", base+path, bytes.NewReader(payload))
	if err != nil {
		return 0, fail(8, "could not create authorization request")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return 0, fail(8, "Skillpack is unavailable; check the API URL")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return response.StatusCode, fail(3, fmt.Sprintf("authorization failed (HTTP %d)", response.StatusCode))
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(destination); err != nil {
		return 0, fail(8, "invalid authorization response")
	}
	return response.StatusCode, nil
}

func (a *app) browserLogin(base string) (string, error) {
	base, err := normalizeAPI(base)
	if err != nil {
		return "", err
	}
	id, err := randomHex(32)
	if err != nil {
		return "", fail(8, "could not start authorization")
	}
	verifier, err := randomHex(32)
	if err != nil {
		return "", fail(8, "could not start authorization")
	}
	hash := sha256.Sum256([]byte(verifier))
	var started struct {
		URL      string `json:"verification_uri"`
		Expires  int    `json:"expires_in"`
		Interval int    `json:"interval"`
	}
	if _, err := publicJSON(base, "/cli-login/start", map[string]string{"request_id": id, "verifier_hash": hex.EncodeToString(hash[:])}, &started); err != nil {
		return "", err
	}
	link, err := url.Parse(started.URL)
	if err != nil || link.User != nil || link.Host == "" || link.Path != "/cli/approve" || link.Query().Get("request_id") != id || !(link.Scheme == "https" || link.Scheme == "http" && (link.Hostname() == "localhost" || link.Hostname() == "127.0.0.1")) {
		return "", fail(8, "server returned an invalid approval URL")
	}
	fmt.Fprintf(a.diagnostic, "Approve Skillpack CLI access: %s\n", link.String())
	if !a.options.flags["no-browser"] {
		if err := openBrowser(link.String()); err != nil {
			fmt.Fprintln(a.diagnostic, "Could not open a browser; open the URL above manually.")
		}
	}
	if started.Expires < 1 || started.Expires > 600 {
		return "", fail(8, "server returned an invalid login lifetime")
	}
	interval := time.Duration(started.Interval) * time.Second
	if interval < time.Second {
		interval = time.Second
	}
	deadline := time.Now().Add(time.Duration(started.Expires) * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(interval)
		var poll struct {
			Status string `json:"status"`
			Token  string `json:"token"`
		}
		status, err := publicJSON(base, "/cli-login/poll", map[string]string{"request_id": id, "verifier": verifier}, &poll)
		if status == 403 {
			return "", fail(3, "CLI access was denied")
		}
		if err != nil {
			return "", err
		}
		switch poll.Status {
		case "pending":
			continue
		case "approved":
			if !strings.HasPrefix(poll.Token, "cmp_pat_") {
				return "", fail(8, "server returned an invalid API key")
			}
			return poll.Token, nil
		default:
			return "", fail(8, "server returned an invalid approval state")
		}
	}
	return "", fail(3, "approval expired; run skillpack auth login again")
}
