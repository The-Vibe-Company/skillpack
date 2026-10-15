package cli

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode"
)

const githubAPIOrigin = "https://api.github.com"

const (
	githubOperationTimeout = 2 * time.Minute
	githubRequestTimeout   = 20 * time.Second
	githubMaxRequests      = maxPackageFiles*3 + 64
	githubMaxTreeEntries   = 100000
	githubMaxRateRetries   = 2
	githubMaxRateWait      = 2 * time.Second
	githubRepositoryLimit  = 512 << 10
	githubTreeLimit        = 8 << 20
)

// githubSource is the stable source contract used by the v3 lock format.
// Ref is nil when the source follows the repository's default branch.
type githubSource struct {
	Extra      map[string]json.RawMessage `json:"-"`
	Type       string                     `json:"type"`
	Repository string                     `json:"repository"`
	Path       string                     `json:"path"`
	Ref        *string                    `json:"ref"`
	Commit     string                     `json:"commit"`

	// treeParts is retained only while resolving a /tree/ URL. GitHub URLs do
	// not delimit a slash-containing ref from its path, so resolution must
	// test each possible split against the repository's refs.
	treeParts []string
}

type githubResolver struct {
	// Keep this field injectable for package tests. A nil Transport still uses
	// http.DefaultTransport. Request origins are fixed to GitHub API/codeload.
	listRefs githubRefReader
	http     *http.Client
	token    string
	requests int
	repos    map[string]githubRepository
}

type githubRepository struct {
	Private       bool   `json:"private"`
	Visibility    string `json:"visibility"`
	DefaultBranch string `json:"default_branch"`
}

type githubTree struct {
	Truncated bool              `json:"truncated"`
	Tree      []githubTreeEntry `json:"tree"`
}

type githubTreeEntry struct {
	Path string `json:"path"`
	Mode string `json:"mode"`
	Type string `json:"type"`
	SHA  string `json:"sha"`
	Size int64  `json:"size"`
}

// githubStatusError keeps the HTTP status available to the resolver without
// exposing response bodies. Its wrapped commandError preserves the CLI exit
// code contract.
type githubStatusError struct {
	status int
	err    error
}

func (e *githubStatusError) Error() string { return e.err.Error() }
func (e *githubStatusError) Unwrap() error { return e.err }

func newGitHubResolver() *githubResolver {
	return &githubResolver{
		http: &http.Client{
			Timeout: githubRequestTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		token: os.Getenv("GITHUB_TOKEN"),
		repos: map[string]githubRepository{},
	}
}

func isGitHubReference(input string) bool {
	if strings.HasPrefix(input, "github:") {
		// Keep malformed shorthand in the GitHub branch so callers report a
		// source-specific usage error instead of treating it as a catalog slug.
		return true
	}
	u, err := url.Parse(input)
	if err != nil || u.Scheme != "https" || !strings.EqualFold(u.Host, "github.com") {
		return false
	}
	// The fixed host is enough to classify the input. Full URL validation is
	// deliberately left to parseGitHubReference so malformed GitHub URLs do
	// not fall through to the anonymous catalog route.
	return true
}

func parseGitHubReference(input, explicitRef string) (githubSource, error) {
	if !isGitHubReference(input) {
		return githubSource{}, fail(2, "invalid GitHub source reference")
	}

	var source githubSource
	source.Type = "github"
	if strings.HasPrefix(input, "github:") {
		repository, path, suffix, hasSuffix, err := parseGitHubShorthand(input[len("github:"):])
		if err != nil {
			return githubSource{}, err
		}
		source.Repository = repository
		source.Path = path
		if hasSuffix {
			source.Ref = stringPointer(suffix)
		}
	} else {
		u, err := url.Parse(input)
		if err != nil || u.Scheme != "https" || !strings.EqualFold(u.Host, "github.com") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
			return githubSource{}, fail(2, "invalid GitHub source URL")
		}
		if hasEncodedTraversal(u) {
			return githubSource{}, fail(2, "invalid GitHub source URL")
		}
		parts, err := githubURLParts(u.Path)
		if err != nil {
			return githubSource{}, err
		}
		source.Repository = strings.ToLower(parts[0] + "/" + parts[1])
		rest := parts[2:]
		if len(rest) == 0 {
			source.Path = ""
		} else if rest[0] == "tree" {
			if len(rest) == 1 {
				return githubSource{}, fail(2, "GitHub tree URL is missing its ref")
			}
			for _, part := range rest[1:] {
				if !validURLTreePart(part) {
					return githubSource{}, fail(2, "invalid GitHub tree URL")
				}
			}
			source.treeParts = append([]string(nil), rest[1:]...)
		} else {
			source.Path = strings.Join(rest, "/")
			if err := validateGitHubPackagePath(source.Path); err != nil {
				return githubSource{}, err
			}
		}
	}

	if explicitRef != "" {
		if !validGitHubRef(explicitRef) {
			return githubSource{}, fail(2, "invalid GitHub ref")
		}
		if source.Ref != nil && *source.Ref != explicitRef {
			return githubSource{}, fail(2, "GitHub source contains conflicting refs")
		}
		source.Ref = stringPointer(explicitRef)
	}
	if source.Path != "" {
		if err := validateGitHubPackagePath(source.Path); err != nil {
			return githubSource{}, err
		}
	}
	return source, nil
}

func parseGitHubShorthand(rest string) (repository, path, ref string, hasRef bool, err error) {
	if rest == "" || strings.ContainsAny(rest, "?#\\") {
		return "", "", "", false, fail(2, "invalid GitHub source reference")
	}
	prefix := rest
	if at := strings.LastIndexByte(rest, '@'); at >= 0 {
		if at == len(rest)-1 {
			return "", "", "", false, fail(2, "invalid GitHub ref")
		}
		prefix, ref, hasRef = rest[:at], rest[at+1:], true
		if !validGitHubRef(ref) {
			return "", "", "", false, fail(2, "invalid GitHub ref")
		}
	}
	parts := strings.Split(prefix, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" || !validGitHubRepoPart(parts[0]) || !validGitHubRepoPart(parts[1]) {
		return "", "", "", false, fail(2, "invalid GitHub repository")
	}
	repository = strings.ToLower(parts[0] + "/" + parts[1])
	if len(parts) > 2 {
		path = strings.Join(parts[2:], "/")
		if err := validateGitHubPackagePath(path); err != nil {
			return "", "", "", false, err
		}
	}
	return repository, path, ref, hasRef, nil
}

func githubURLParts(rawPath string) ([]string, error) {
	if rawPath == "" || !strings.HasPrefix(rawPath, "/") {
		return nil, fail(2, "invalid GitHub source URL")
	}
	trimmed := strings.TrimPrefix(rawPath, "/")
	trimmed = strings.TrimSuffix(trimmed, "/")
	if trimmed == "" {
		return nil, fail(2, "invalid GitHub repository")
	}
	parts := strings.Split(trimmed, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" || !validGitHubRepoPart(parts[0]) || !validGitHubRepoPart(parts[1]) {
		return nil, fail(2, "invalid GitHub repository")
	}
	for _, part := range parts[2:] {
		if part == "" || part == "." || part == ".." || strings.ContainsAny(part, "\\\x00\r\n") {
			return nil, fail(2, "invalid GitHub source URL")
		}
	}
	return parts, nil
}

func hasEncodedTraversal(u *url.URL) bool {
	escaped := strings.ToLower(u.EscapedPath())
	return strings.Contains(escaped, "%2f") || strings.Contains(escaped, "%5c") || strings.Contains(escaped, "%2e") || strings.Contains(escaped, "%00")
}

func validURLTreePart(part string) bool {
	if part == "" || part == "." || part == ".." || strings.ContainsAny(part, "\\\x00\r\n") {
		return false
	}
	for _, r := range part {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func validGitHubRepoPart(part string) bool {
	if part == "" || part == "." || part == ".." || len(part) > 100 {
		return false
	}
	for _, r := range part {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("-_.", r)) {
			return false
		}
	}
	return true
}

func validGitHubRepository(repository string) bool {
	parts := strings.Split(repository, "/")
	return len(parts) == 2 && validGitHubRepoPart(parts[0]) && validGitHubRepoPart(parts[1])
}

func validGitHubRef(ref string) bool {
	if ref == "" || ref == "@" || len(ref) > 1024 || strings.HasPrefix(ref, "/") || strings.HasSuffix(ref, "/") || strings.HasSuffix(ref, ".") || strings.HasSuffix(ref, ".lock") || strings.Contains(ref, "..") || strings.Contains(ref, "//") || strings.Contains(ref, "@{") {
		return false
	}
	for _, part := range strings.Split(ref, "/") {
		if part == "" || part == "." || part == ".." || strings.HasPrefix(part, ".") || strings.HasSuffix(part, ".lock") {
			return false
		}
	}
	for _, r := range ref {
		if unicode.IsControl(r) || unicode.IsSpace(r) || strings.ContainsRune("~^:?*[\\", r) {
			return false
		}
	}
	return true
}

func validateGitHubPackagePath(path string) error {
	if path == "" {
		return nil
	}
	if _, err := safePackagePath(path); err != nil {
		return fail(2, "invalid GitHub package path")
	}
	return nil
}

func safeGitHubPackagePath(path string) bool {
	if path == "" {
		return true
	}
	_, err := safePackagePath(path)
	return err == nil
}

func stringPointer(value string) *string { return &value }

func githubCode(err error) int {
	var ce *commandError
	if errors.As(err, &ce) {
		return ce.code
	}
	return 8
}

func githubHasStatus(err error, status int) bool {
	var ge *githubStatusError
	return errors.As(err, &ge) && ge.status == status
}

func validGitHubSHA(value string) bool {
	if len(value) != 40 {
		return false
	}
	for _, r := range value {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F') {
			return false
		}
	}
	return true
}

func (g *githubResolver) resolve(source githubSource) (githubSource, error) {
	if source.Type != "github" || !validGitHubRepository(source.Repository) {
		return githubSource{}, fail(2, "invalid GitHub source")
	}
	source.Repository = strings.ToLower(source.Repository)
	if !safeGitHubPackagePath(source.Path) {
		return githubSource{}, fail(5, "GitHub package path is unsafe")
	}
	ctx, cancel := context.WithTimeout(context.Background(), githubOperationTimeout)
	defer cancel()
	if _, err := g.repository(ctx, source.Repository); err != nil {
		return githubSource{}, err
	}

	resolved := source
	var ref string
	var commit string
	var err error
	switch {
	case len(source.treeParts) > 0:
		ref, resolved.Path, commit, err = g.resolveTreeURL(ctx, source.Repository, source.treeParts, source.Ref)
		if err != nil {
			return githubSource{}, err
		}
		if !safeGitHubPackagePath(resolved.Path) {
			return githubSource{}, fail(5, "GitHub package path is unsafe")
		}
		resolved.Ref = stringPointer(ref)
	case source.Ref != nil:
		ref = *source.Ref
		if !validGitHubRef(ref) {
			return githubSource{}, fail(2, "invalid GitHub ref")
		}
		commit, err = g.resolveRef(ctx, source.Repository, ref)
		if err != nil {
			return githubSource{}, err
		}
	case source.Commit != "":
		if !validGitHubSHA(source.Commit) {
			return githubSource{}, fail(5, "GitHub source is not pinned to a full commit")
		}
		commit = source.Commit
	case true:
		info, infoErr := g.repository(ctx, source.Repository)
		if infoErr != nil {
			return githubSource{}, infoErr
		}
		ref = info.DefaultBranch
		if !validGitHubRef(ref) {
			return githubSource{}, fail(5, "GitHub repository has an invalid default branch")
		}
		commit, err = g.resolveRef(ctx, source.Repository, "HEAD")
		if err != nil {
			return githubSource{}, err
		}
	}
	if resolved.Ref != nil && validGitHubSHA(*resolved.Ref) {
		resolved.Ref = stringPointer(strings.ToLower(*resolved.Ref))
	}
	resolved.Commit = strings.ToLower(commit)
	return resolved, nil
}

func (g *githubResolver) resolveTreeURL(ctx context.Context, repository string, parts []string, explicit *string) (string, string, string, error) {
	if len(parts) == 0 {
		return "", "", "", fail(2, "GitHub tree URL is missing its ref")
	}
	if explicit != nil {
		if !validGitHubRef(*explicit) {
			return "", "", "", fail(2, "invalid GitHub ref")
		}
		refParts := strings.Split(*explicit, "/")
		if len(refParts) > len(parts) || !sameStrings(refParts, parts[:len(refParts)]) {
			return "", "", "", fail(5, "GitHub URL ref does not match its tree path")
		}
		commit, err := g.resolveRef(ctx, repository, *explicit)
		if err != nil {
			return "", "", "", err
		}
		return *explicit, strings.Join(parts[len(refParts):], "/"), commit, nil
	}

	type candidate struct{ ref, path, commit string }
	patterns := []string{}
	for i := 1; i <= len(parts); i++ {
		ref := strings.Join(parts[:i], "/")
		if validGitHubRef(ref) && !validGitHubSHA(ref) {
			patterns = append(patterns, githubRefPatterns(ref)...)
		}
	}
	refs := map[string]string{}
	if len(patterns) > 0 {
		var err error
		refs, err = g.resolveRefs(ctx, repository, patterns)
		if err != nil {
			return "", "", "", err
		}
	}
	candidates := []candidate{}
	for i := 1; i <= len(parts); i++ {
		ref := strings.Join(parts[:i], "/")
		if !validGitHubRef(ref) {
			continue
		}
		commit, err := commitForGitHubRef(refs, ref)
		if err == nil {
			candidates = append(candidates, candidate{ref, strings.Join(parts[i:], "/"), commit})
			continue
		}
		if githubHasStatus(err, 404) {
			continue
		}
		return "", "", "", err
	}
	if len(candidates) == 0 {
		return "", "", "", &githubStatusError{status: 404, err: fail(4, "GitHub tree ref was not found")}
	}
	if len(candidates) > 1 {
		return "", "", "", fail(5, "GitHub tree URL has an ambiguous ref; provide --ref")
	}
	return candidates[0].ref, candidates[0].path, candidates[0].commit, nil
}

func sameStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func (g *githubResolver) resolveRef(ctx context.Context, repository, ref string) (string, error) {
	if !validGitHubRef(ref) {
		return "", fail(2, "invalid GitHub ref")
	}
	if validGitHubSHA(ref) {
		return strings.ToLower(ref), nil
	}
	refs, err := g.resolveRefs(ctx, repository, githubRefPatterns(ref))
	if err != nil {
		return "", err
	}
	return commitForGitHubRef(refs, ref)
}

func (g *githubResolver) repository(ctx context.Context, repository string) (githubRepository, error) {
	if !validGitHubRepository(repository) {
		return githubRepository{}, fail(2, "invalid GitHub repository")
	}
	if g.repos == nil {
		g.repos = map[string]githubRepository{}
	}
	if info, ok := g.repos[repository]; ok {
		if info.Private || !strings.EqualFold(info.Visibility, "public") {
			return githubRepository{}, fail(7, "GitHub repository is private; public repositories only")
		}
		return info, nil
	}
	body, err := g.request(ctx, "/repos/"+repository, githubRepositoryLimit)
	if err != nil {
		return githubRepository{}, err
	}
	var info githubRepository
	if json.Unmarshal(body, &info) != nil {
		return githubRepository{}, fail(8, "GitHub returned an invalid repository response")
	}
	if info.Private || !strings.EqualFold(info.Visibility, "public") {
		return githubRepository{}, fail(7, "GitHub repository is private; public repositories only")
	}
	if !validGitHubRef(info.DefaultBranch) {
		return githubRepository{}, fail(5, "GitHub repository has no usable default branch")
	}
	g.repos[repository] = info
	return info, nil
}

func (g *githubResolver) download(source githubSource) (map[string][]byte, []string, error) {
	if source.Type != "github" || !validGitHubRepository(source.Repository) {
		return nil, nil, fail(2, "invalid GitHub source")
	}
	if !validGitHubSHA(source.Commit) {
		return nil, nil, fail(5, "GitHub download requires a full commit")
	}
	if !safeGitHubPackagePath(source.Path) {
		return nil, nil, fail(5, "GitHub package path is unsafe")
	}
	ctx, cancel := context.WithTimeout(context.Background(), githubOperationTimeout)
	defer cancel()
	if _, err := g.repository(ctx, source.Repository); err != nil {
		return nil, nil, err
	}

	tree, err := g.getTree(ctx, source.Repository, source.Commit)
	if err != nil {
		return nil, nil, err
	}
	expected, err := githubSelectedTree(tree.Tree, source.Path)
	if err != nil {
		return nil, nil, err
	}
	return g.downloadTarball(ctx, source, expected)
}

// One bounded recursive listing preserves gitlink detection (archives omit
// submodules) and anchors every downloaded file to its Git blob checksum.
func (g *githubResolver) getTree(ctx context.Context, repository, sha string) (githubTree, error) {
	if !validGitHubSHA(sha) {
		return githubTree{}, fail(5, "GitHub tree is not pinned to a full commit")
	}
	body, err := g.request(ctx, "/repos/"+repository+"/git/trees/"+strings.ToLower(sha)+"?recursive=1", githubTreeLimit)
	if err != nil {
		return githubTree{}, err
	}
	var tree githubTree
	if json.Unmarshal(body, &tree) != nil {
		return githubTree{}, fail(8, "GitHub returned an invalid tree response")
	}
	if tree.Truncated || len(tree.Tree) > githubMaxTreeEntries {
		return githubTree{}, fail(5, "GitHub tree is truncated or exceeds the entry limit")
	}
	return tree, nil
}

func githubSelectedTree(entries []githubTreeEntry, selected string) (map[string]githubTreeEntry, error) {
	result := map[string]githubTreeEntry{}
	seen := portablePaths{}
	exact := map[string]bool{}
	found := selected == ""
	total := int64(0)
	count := 0
	for _, entry := range entries {
		// Validate selected contents, ancestors, and siblings of each ancestor,
		// matching the old directory-by-directory traversal's collision checks.
		parent := ""
		if i := strings.LastIndexByte(entry.Path, '/'); i >= 0 {
			parent = entry.Path[:i]
		}
		inside := selected == "" || strings.HasPrefix(entry.Path, selected+"/")
		ancestor := entry.Path == selected || strings.HasPrefix(selected, entry.Path+"/")
		sibling := parent == "" || parent == selected || strings.HasPrefix(selected, parent+"/")
		if !inside && !ancestor && !sibling {
			continue
		}
		if _, err := safePackagePath(entry.Path); err != nil {
			return nil, err
		}
		if exact[entry.Path] {
			return nil, fail(5, "GitHub tree contains duplicate paths")
		}
		exact[entry.Path] = true
		if err := seen.add(entry.Path, entry.Type == "tree"); err != nil {
			return nil, err
		}
		if !inside && !ancestor {
			continue
		}
		if err := validateGitHubTreeEntry(entry); err != nil {
			return nil, err
		}
		if ancestor {
			if entry.Type != "tree" {
				return nil, fail(5, "GitHub package path is not a directory")
			}
			if entry.Path == selected {
				found = true
			}
			continue
		}
		rel := entry.Path
		if selected != "" {
			rel = strings.TrimPrefix(entry.Path, selected+"/")
		}
		if excludedPackagePath(rel) {
			continue
		}
		if entry.Type == "blob" {
			count++
			total += entry.Size
			if count > maxPackageFiles || entry.Size > maxFileBytes || total > maxPackageBytes || rel == "SKILL.md" && entry.Size > 1<<20 {
				return nil, fail(5, "GitHub package exceeds the size or file limit")
			}
		}
		result[rel] = entry
	}
	if !found {
		return nil, &githubStatusError{status: 404, err: fail(4, "GitHub package path was not found")}
	}
	return result, nil
}

func validateGitHubTreeEntry(entry githubTreeEntry) error {
	switch entry.Mode {
	case "040000":
		if entry.Type != "tree" || !validGitHubSHA(entry.SHA) {
			return fail(5, "GitHub tree contains an invalid directory")
		}
	case "100644", "100755":
		if entry.Type != "blob" || !validGitHubSHA(entry.SHA) {
			return fail(5, "GitHub tree contains an invalid file")
		}
		if entry.Size < 0 {
			return fail(5, "GitHub tree contains an invalid file size")
		}
	case "120000":
		return fail(5, "GitHub package contains a symbolic link")
	case "160000":
		return fail(5, "GitHub package contains a submodule")
	default:
		return fail(5, "GitHub package contains a special file")
	}
	return nil
}

func (g *githubResolver) request(ctx context.Context, path string, limit int64) ([]byte, error) {
	apiPath := strings.TrimSuffix(path, "?recursive=1")
	if !strings.HasPrefix(apiPath, "/repos/") || strings.ContainsAny(apiPath, "?#\r\n") || strings.Contains(apiPath, "//") || apiPath != path && !strings.Contains(apiPath, "/git/trees/") {
		return nil, fail(2, "invalid GitHub API path")
	}
	for attempt := 0; attempt <= githubMaxRateRetries; attempt++ {
		if g.requests >= githubMaxRequests {
			return nil, fail(8, "GitHub request budget exceeded; narrow the package path or retry later")
		}
		g.requests++
		requestURL := githubAPIOrigin + path
		u, err := url.Parse(requestURL)
		if err != nil || u.Scheme != "https" || u.Host != "api.github.com" || u.User != nil || (u.RawQuery != "" && u.RawQuery != "recursive=1") || u.Fragment != "" {
			return nil, fail(2, "invalid GitHub API request")
		}
		reqCtx, cancel := context.WithTimeout(ctx, githubRequestTimeout)
		req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, requestURL, nil)
		if err != nil {
			cancel()
			return nil, fail(8, "could not create GitHub request")
		}
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("User-Agent", "skillpack-native")
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		if g.token != "" {
			if strings.ContainsAny(g.token, "\r\n") {
				cancel()
				return nil, fail(8, "GITHUB_TOKEN is invalid; provide a valid token")
			}
			req.Header.Set("Authorization", "Bearer "+g.token)
		}
		client := g.http
		if client == nil {
			client = newGitHubResolver().http
		}
		// Copy the client so injected transports remain useful in tests while
		// redirects stay disabled even when a test supplies a bare http.Client.
		clientCopy := *client
		clientCopy.CheckRedirect = func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}
		resp, err := clientCopy.Do(req)
		if err != nil {
			cancel()
			if ctx.Err() != nil {
				return nil, fail(8, "GitHub request timed out")
			}
			return nil, fail(8, "GitHub request failed; retry later or set GITHUB_TOKEN")
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			data, readErr := io.ReadAll(io.LimitReader(resp.Body, limit+1))
			_ = resp.Body.Close()
			cancel()
			if readErr != nil || int64(len(data)) > limit {
				return nil, fail(8, "GitHub response was incomplete or oversized")
			}
			return data, nil
		}
		if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
			delay := githubRateDelay(resp)
			_ = resp.Body.Close()
			cancel()
			if attempt < githubMaxRateRetries && delay <= githubMaxRateWait {
				if err := waitGitHub(ctx, delay); err != nil {
					return nil, fail(8, "GitHub rate limit wait was interrupted")
				}
				continue
			}
			return nil, &githubStatusError{status: resp.StatusCode, err: fail(8, githubRateLimitMessage(delay))}
		}
		status := resp.StatusCode
		_ = resp.Body.Close()
		cancel()
		switch {
		case status == http.StatusUnauthorized:
			return nil, &githubStatusError{status: status, err: fail(8, "GITHUB_TOKEN was rejected; remove it or provide a valid token")}
		case status == http.StatusNotFound:
			return nil, &githubStatusError{status: status, err: fail(4, "GitHub repository or reference was not found")}
		case status == http.StatusBadRequest || status == http.StatusUnprocessableEntity:
			return nil, &githubStatusError{status: status, err: fail(5, "GitHub rejected the requested resource")}
		case status >= 500:
			return nil, &githubStatusError{status: status, err: fail(8, "GitHub server failed; retry later")}
		default:
			return nil, &githubStatusError{status: status, err: fail(8, "GitHub request was rejected")}
		}
	}
	return nil, fail(8, "GitHub request failed")
}

func githubRateLimitMessage(delay time.Duration) string {
	if delay > 0 {
		seconds := (delay + time.Second - 1) / time.Second
		return "GitHub API rate limit reached; retry after " + strconv.FormatInt(int64(seconds), 10) + " seconds or set GITHUB_TOKEN"
	}
	return "GitHub API rate limit reached; retry shortly or set GITHUB_TOKEN"
}

func githubRateDelay(resp *http.Response) time.Duration {
	if value := strings.TrimSpace(resp.Header.Get("Retry-After")); value != "" {
		if seconds, err := strconv.Atoi(value); err == nil && seconds >= 0 {
			return time.Duration(seconds) * time.Second
		}
		if when, err := http.ParseTime(value); err == nil {
			if delay := time.Until(when); delay > 0 {
				return delay
			}
			return 0
		}
	}
	if value := strings.TrimSpace(resp.Header.Get("X-RateLimit-Reset")); value != "" {
		if unix, err := strconv.ParseInt(value, 10, 64); err == nil {
			if delay := time.Until(time.Unix(unix, 0)); delay > 0 {
				return delay
			}
		}
	}
	return 0
}

func waitGitHub(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
