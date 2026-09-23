package cli

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type client struct {
	base, key string
	http      *http.Client
}

func normalizeAPI(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", fail(2, "provide a valid API origin")
	}
	ip := net.ParseIP(u.Hostname())
	local := u.Hostname() == "localhost" || (ip != nil && ip.IsLoopback())
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return "", fail(2, "API requires HTTPS (HTTP allowed only on loopback)")
	}
	if u.Path != "" && u.Path != "/" && u.Path != "/v1" && u.Path != "/v1/" {
		return "", fail(2, "API URL must be an origin or end in /v1")
	}
	u.Path = "/v1"
	return strings.TrimRight(u.String(), "/"), nil
}
func newClient(base, key string) (*client, error) {
	base, err := normalizeAPI(base)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(key, "cmp_pat_") || strings.ContainsAny(key, "\r\n\t ") {
		return nil, fail(3, "a Skillpack API key is required; run skillpack auth login")
	}
	return &client{base, key, &http.Client{Timeout: 45 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func validSegment(s string) bool {
	if s == "" || s == "." || s == ".." {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("-_.@", r)) {
			return false
		}
	}
	return true
}
func safeAPIPath(path string) bool {
	u, err := url.Parse(path)
	if err != nil || u.IsAbs() || u.Host != "" || u.Fragment != "" || !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") {
		return false
	}
	if strings.ContainsAny(u.EscapedPath(), "%\\") {
		return false
	}
	for _, segment := range strings.Split(u.Path, "/")[1:] {
		if !validSegment(segment) {
			return false
		}
	}
	return true
}
func (c *client) request(method, path string, body []byte, contentType string, limit int64) ([]byte, error) {
	if !safeAPIPath(path) {
		return nil, fail(2, "invalid API path")
	}
	req, err := http.NewRequest(method, c.base+path, bytes.NewReader(body))
	if err != nil {
		return nil, fail(2, "invalid request")
	}
	req.Header.Set("Authorization", "Bearer "+c.key)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "skillpack-native")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fail(8, "API request failed; write outcome may be unknown, inspect before retrying")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		code := 8
		message := "API request failed"
		switch resp.StatusCode {
		case 401:
			code = 3
			message = "API key expired, revoked or unavailable; run auth status/login"
		case 403:
			code = 7
			message = "API key or member cannot access this operation"
		case 404:
			code = 4
			message = "API operation or resource unavailable; check server version and resource"
		case 409:
			code = 6
			message = "API conflict; inspect current state before retrying"
		case 400, 422:
			code = 5
			message = "API rejected the request; check its documented input"
		}
		return nil, fail(code, fmt.Sprintf("%s (HTTP %d)", message, resp.StatusCode))
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil || int64(len(b)) > limit {
		return nil, fail(8, "API response incomplete or oversized")
	}
	return b, nil
}
func (c *client) json(method, path string, body []byte) (any, error) {
	b, err := c.request(method, path, body, "application/json", 16<<20)
	if err != nil {
		return nil, err
	}
	if len(b) == 0 {
		return map[string]any{"ok": true}, nil
	}
	var result any
	if json.Unmarshal(b, &result) != nil {
		return nil, fail(8, "API response is not JSON")
	}
	return result, nil
}

func allowedOperation(method, path string) bool {
	if !safeAPIPath(path) {
		return false
	}
	u, _ := url.Parse(path)
	if u.Path == "/tokens/current" {
		return method == "GET"
	}
	if u.Path == "/tokens" || u.Path == "/secret-grants/redeem" || strings.HasPrefix(u.Path, "/secret-retrievals/") {
		return false
	}
	var operations []struct {
		Method    string `json:"method"`
		Path      string `json:"path"`
		Transport string `json:"transport"`
	}
	if json.Unmarshal(operationRegistry, &operations) != nil {
		return false
	}
	parts := strings.Split(u.Path, "/")
	for _, operation := range operations {
		if operation.Method != method || operation.Transport != "rest" {
			continue
		}
		pattern := strings.Split(operation.Path, "/")
		if len(parts) != len(pattern) {
			continue
		}
		matches := true
		for i, p := range pattern {
			if !strings.HasPrefix(p, ":") && p != parts[i] {
				matches = false
				break
			}
		}
		if matches {
			return true
		}
	}
	return false
}

//go:embed contracts/operations.json
var operationRegistry []byte
