package cli

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha1"
	"errors"
	"fmt"
	"golang.org/x/text/unicode/norm"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// The codeload endpoint returns the whole repository, so these limits apply to
// the archive before the package path is selected. They are intentionally
// separate from the package limits below: skipped repository files still have
// to be streamed and accounted for, but are never retained in memory.
const (
	githubMaxCompressedBytes   int64 = 2 << 30
	githubMaxDecompressedBytes int64 = 8 << 30
)

const githubTarballSkillLimit int64 = 1 << 20

var (
	errGitHubTarballCompressedLimit   = errors.New("GitHub tarball compressed size limit exceeded")
	errGitHubTarballDecompressedLimit = errors.New("GitHub tarball decompressed size limit exceeded")
)

// downloadTarball fetches and verifies the codeload archive for source. The
// expected map is keyed by paths relative to source.Path and contains the
// entries from one recursive Git tree. Directory entries are useful for
// checking archive structure, while regular files are checked by both size
// and Git's blob SHA-1 identity.
func (g *githubResolver) downloadTarball(ctx context.Context, source githubSource, expected map[string]githubTreeEntry) (map[string][]byte, []string, error) {
	return g.downloadTarballWithLimits(ctx, source, expected, githubMaxCompressedBytes, githubMaxDecompressedBytes)
}

// downloadTarballWithLimits is kept internal so tests can exercise the
// streaming guards with small bounded fixtures. Production callers use
// downloadTarball, which supplies the repository-wide limits above.
func (g *githubResolver) downloadTarballWithLimits(ctx context.Context, source githubSource, expected map[string]githubTreeEntry, compressedLimit, decompressedLimit int64) (map[string][]byte, []string, error) {
	if source.Type != "github" || !validGitHubRepository(source.Repository) {
		return nil, nil, fail(2, "invalid GitHub source")
	}
	if !validGitHubSHA(source.Commit) {
		return nil, nil, fail(5, "GitHub download requires a full commit")
	}
	if !safeGitHubPackagePath(source.Path) {
		return nil, nil, fail(5, "GitHub package path is unsafe")
	}
	if compressedLimit <= 0 || decompressedLimit <= 0 {
		return nil, nil, fail(8, "GitHub tarball limits are invalid")
	}

	expectedFiles, expectedDirs, err := validateGitHubTarballExpected(expected)
	if err != nil {
		return nil, nil, err
	}

	body, cancel, err := g.openGitHubTarball(ctx, source, compressedLimit)
	if err != nil {
		return nil, nil, err
	}
	defer cancel()
	defer body.Close()

	compressed := &githubTarballLimitReader{r: body, limit: compressedLimit, limitErr: errGitHubTarballCompressedLimit}
	gzipReader, err := gzip.NewReader(compressed)
	if err != nil {
		if compressed.n > compressed.limit {
			return nil, nil, githubRepositoryLimitError("compressed", compressedLimit)
		}
		return nil, nil, fail(5, "GitHub tarball is not valid gzip")
	}
	// Keep the raw reader byte-addressable so gzip can leave any subsequent
	// member or bytes for the explicit trailing-data check below.
	gzipReader.Multistream(false)
	decompressed := &githubTarballLimitReader{r: gzipReader, limit: decompressedLimit, limitErr: errGitHubTarballDecompressedLimit}
	archive := tar.NewReader(decompressed)
	parser := githubTarballParser{
		limits:           g.limits.normalized(),
		compressed:       compressed,
		decompressed:     decompressed,
		sourcePath:       source.Path,
		commit:           strings.ToLower(source.Commit),
		expectedFiles:    expectedFiles,
		expectedDirs:     expectedDirs,
		files:            map[string][]byte{},
		executables:      map[string]struct{}{},
		selectedPortable: portablePaths{},
		selectedEntries:  map[string]struct{}{},
		ancestorEntries:  map[string]struct{}{},
		expectedSeen:     map[string]struct{}{},
	}

	for {
		header, nextErr := archive.Next()
		if nextErr == io.EOF {
			break
		}
		if nextErr != nil {
			return nil, nil, parser.archiveError(nextErr, compressed, decompressed)
		}
		if err := parser.entry(header, archive); err != nil {
			return nil, nil, err
		}
	}

	// archive/tar stops after the two end blocks. Continue reading the gzip
	// stream to verify its checksum and to account for trailing decompressed
	// bytes, including data after the tar end marker.
	trailingNonZero := false
	var drain [32 << 10]byte
	for {
		n, readErr := decompressed.Read(drain[:])
		if n > 0 {
			for _, value := range drain[:n] {
				if value != 0 {
					trailingNonZero = true
				}
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return nil, nil, parser.archiveError(readErr, compressed, decompressed)
		}
	}
	if err := gzipReader.Close(); err != nil {
		return nil, nil, parser.archiveError(err, compressed, decompressed)
	}
	// With multistream disabled, drain the raw response as well so an invalid
	// trailing member cannot bypass the compressed limit.
	trailingCompressed := false
	for {
		n, readErr := compressed.Read(drain[:])
		if n > 0 {
			trailingCompressed = true
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return nil, nil, parser.archiveError(readErr, compressed, decompressed)
		}
		if n == 0 {
			return nil, nil, fail(5, "GitHub tarball could not be read")
		}
		trailingCompressed = true
	}
	if compressed.n > compressed.limit {
		return nil, nil, githubRepositoryLimitError("compressed", compressedLimit)
	}
	if decompressed.n > decompressed.limit {
		return nil, nil, githubRepositoryLimitError("decompressed", decompressedLimit)
	}
	if trailingNonZero || trailingCompressed {
		return nil, nil, fail(5, "GitHub tarball contains trailing data")
	}

	if err := parser.finish(); err != nil {
		return nil, nil, err
	}
	if _, err := validatePackage(parser.files); err != nil {
		return nil, nil, err
	}

	list := make([]string, 0, len(parser.executables))
	for name := range parser.executables {
		list = append(list, name)
	}
	sort.Strings(list)
	return parser.files, list, nil
}

// openGitHubTarball keeps the codeload URL fixed and deliberately creates a
// fresh client copy with no cookie jar. A resolver token is only for the API;
// it must never reach codeload, including through a redirect.
func (g *githubResolver) openGitHubTarball(ctx context.Context, source githubSource, compressedLimit int64) (io.ReadCloser, func(), error) {
	commit := strings.ToLower(source.Commit)
	requestURL := "https://codeload.github.com/" + strings.ToLower(source.Repository) + "/tar.gz/" + commit
	u, err := url.Parse(requestURL)
	if err != nil || u.Scheme != "https" || u.Host != "codeload.github.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, func() {}, fail(2, "invalid GitHub tarball request")
	}

	client := g.http
	if client == nil {
		client = newGitHubResolver().http
	}
	for attempt := 0; attempt <= githubMaxRateRetries; attempt++ {
		if g.requests >= githubMaxRequests {
			return nil, func() {}, fail(8, "GitHub request budget exceeded; narrow the package path or retry later")
		}
		g.requests++
		reqCtx, cancel := context.WithTimeout(ctx, githubOperationTimeout)
		req, reqErr := http.NewRequestWithContext(reqCtx, http.MethodGet, requestURL, nil)
		if reqErr != nil {
			cancel()
			return nil, func() {}, fail(8, "could not create GitHub tarball request")
		}
		req.Header.Set("User-Agent", "skillpack-native")
		// The response itself is the gzip stream we must account for. Do not
		// let net/http transparently decode a Content-Encoding layer first.
		req.Header.Set("Accept-Encoding", "identity")

		clientCopy := *client
		clientCopy.Timeout = githubOperationTimeout
		clientCopy.CheckRedirect = func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}
		clientCopy.Jar = nil
		resp, doErr := clientCopy.Do(req)
		if doErr != nil {
			cancel()
			if ctx.Err() != nil {
				return nil, func() {}, fail(8, "GitHub tarball download timed out")
			}
			return nil, func() {}, fail(8, "GitHub tarball download failed; retry later")
		}

		if resp.ContentLength > compressedLimit {
			if resp.Body != nil {
				_ = resp.Body.Close()
			}
			cancel()
			return nil, func() {}, githubRepositoryLimitError("compressed", compressedLimit)
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			if resp.Body == nil {
				cancel()
				return nil, func() {}, fail(8, "GitHub tarball response was empty")
			}
			return resp.Body, cancel, nil
		}

		if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
			delay := githubRateDelay(resp)
			if resp.Body != nil {
				_ = resp.Body.Close()
			}
			cancel()
			if attempt < githubMaxRateRetries && delay <= githubMaxRateWait {
				if waitErr := waitGitHub(ctx, delay); waitErr != nil {
					return nil, func() {}, fail(8, "GitHub rate limit wait was interrupted")
				}
				continue
			}
			return nil, func() {}, &githubStatusError{status: resp.StatusCode, err: fail(8, githubRateLimitMessage(delay))}
		}

		status := resp.StatusCode
		if resp.Body != nil {
			_ = resp.Body.Close()
		}
		cancel()
		switch {
		case status == http.StatusNotFound:
			return nil, func() {}, &githubStatusError{status: status, err: fail(4, "GitHub repository or commit was not found")}
		case status == http.StatusBadRequest || status == http.StatusUnprocessableEntity:
			return nil, func() {}, &githubStatusError{status: status, err: fail(5, "GitHub rejected the tarball request")}
		case status >= 300 && status < 400:
			return nil, func() {}, &githubStatusError{status: status, err: fail(8, "GitHub tarball redirect was rejected")}
		case status >= 500:
			return nil, func() {}, &githubStatusError{status: status, err: fail(8, "GitHub tarball service failed; retry later")}
		default:
			return nil, func() {}, &githubStatusError{status: status, err: fail(8, "GitHub tarball request was rejected")}
		}
	}
	return nil, func() {}, fail(8, "GitHub tarball request failed")
}

type githubTarballLimitReader struct {
	r        io.Reader
	limit    int64
	n        int64
	limitErr error
}

func (r *githubTarballLimitReader) Read(p []byte) (int, error) {
	if r.n > r.limit {
		return 0, r.limitErr
	}
	remaining := r.limit + 1 - r.n
	if remaining <= 0 {
		return 0, r.limitErr
	}
	if int64(len(p)) > remaining {
		p = p[:int(remaining)]
	}
	n, err := r.r.Read(p)
	r.n += int64(n)
	if r.n > r.limit {
		return n, r.limitErr
	}
	return n, err
}

func (r *githubTarballLimitReader) ReadByte() (byte, error) {
	var one [1]byte
	n, err := r.Read(one[:])
	if n == 1 {
		return one[0], err
	}
	return 0, err
}

type githubTarballParser struct {
	compressed, decompressed *githubTarballLimitReader
	limits                   githubSkillLimits
	sourcePath               string
	commit                   string
	archiveRoot              string
	packagePrefix            string

	expectedFiles map[string]githubTreeEntry
	expectedDirs  map[string]githubTreeEntry
	expectedSeen  map[string]struct{}

	files            map[string][]byte
	executables      map[string]struct{}
	selectedPortable portablePaths
	selectedEntries  map[string]struct{}
	ancestorEntries  map[string]struct{}
	selectedTotal    int64
	selectedCount    int
	selectedRoot     bool
}

func (p *githubTarballParser) entry(h *tar.Header, archive io.Reader) error {
	if h == nil || !utf8.ValidString(h.Name) {
		return fail(5, "GitHub tarball contains an unsafe path")
	}
	// Validate every name before deciding whether it belongs to the selected
	// package. This also prevents an excluded repository path from becoming a
	// traversal primitive if a future selector changes.
	name, err := safePackagePath(h.Name)
	if err != nil {
		return err
	}
	if h.Typeflag == tar.TypeXGlobalHeader {
		if h.Size != 0 {
			return fail(5, "GitHub tarball has an invalid global header")
		}
		for key, value := range h.PAXRecords {
			if key != "comment" {
				return fail(5, "GitHub tarball has an unsupported global header")
			}
			if value != "" && !strings.EqualFold(value, p.commit) {
				return fail(5, "GitHub tarball commit comment differs from Git tree")
			}
		}
		return nil
	}
	if p.archiveRoot == "" {
		p.archiveRoot = strings.Split(name, "/")[0]
		if _, err := safePackagePath(p.archiveRoot); err != nil {
			return err
		}
		p.packagePrefix = p.archiveRoot
		if p.sourcePath != "" {
			p.packagePrefix += "/" + p.sourcePath
		}
	}
	if name != p.archiveRoot && !strings.HasPrefix(name, p.archiveRoot+"/") {
		return fail(5, "GitHub tarball contains multiple archive roots")
	}

	selected, rel := p.selectedPath(name)
	ancestor := p.selectedAncestor(name)
	if name == p.archiveRoot {
		ancestor = true
	}
	if !selected && !ancestor {
		return nil
	}

	if strings.HasSuffix(h.Name, "/") && h.Typeflag != tar.TypeDir {
		return fail(5, "GitHub tarball has an invalid directory entry")
	}
	if h.Size < 0 {
		return fail(5, "GitHub tarball has an invalid entry size")
	}
	if h.Mode&int64(os.ModeType) != 0 {
		return fail(5, "GitHub tarball contains a special file")
	}
	if githubTarballHasSparse(h) {
		return fail(5, "GitHub tarball contains a sparse file")
	}
	switch h.Typeflag {
	case tar.TypeDir:
		// accepted below
	case tar.TypeReg, tar.TypeRegA:
	default:
		// Reject links and special files in the selected subtree and its
		// ancestors, including excluded package directories.
		return fail(5, "GitHub tarball contains links or special entries")
	}

	if name == p.archiveRoot && h.Typeflag != tar.TypeDir {
		return fail(5, "GitHub tarball root is not a directory")
	}
	if ancestor && !selected {
		if h.Typeflag != tar.TypeDir {
			return fail(5, "GitHub package ancestor is not a directory")
		}
		key := portablePathKey(name)
		if _, exists := p.ancestorEntries[key]; exists {
			return fail(5, "GitHub tarball contains duplicate directories")
		}
		p.ancestorEntries[key] = struct{}{}
		return nil
	}
	if rel != "" && excludedPackagePath(rel) {
		return nil
	}
	if rel == "" {
		if h.Typeflag != tar.TypeDir {
			return fail(5, "GitHub package root is not a directory")
		}
		if p.selectedRoot {
			return fail(5, "GitHub tarball contains duplicate directories")
		}
		p.selectedRoot = true
		return nil
	}

	isDir := h.Typeflag == tar.TypeDir
	if err := p.addSelected(rel, isDir); err != nil {
		return err
	}
	if isDir {
		if _, ok := p.expectedDirs[rel]; !ok {
			return fail(5, "GitHub tarball contains an unexpected directory")
		}
		return nil
	}

	expected, ok := p.expectedFiles[rel]
	if !ok {
		return fail(5, "GitHub tarball contains an unexpected file")
	}
	if h.Size != expected.Size {
		return fail(5, "GitHub tarball file size differs from Git tree")
	}
	if err := p.limits.check(h.Size, p.selectedTotal, p.selectedCount); err != nil {
		return err
	}
	if rel == "SKILL.md" && h.Size > githubTarballSkillLimit {
		return fail(5, "SKILL.md exceeds the fixed size limit (1048576 bytes); move supporting content to separate files")
	}

	data := make([]byte, int(h.Size))
	if _, err := io.ReadFull(archive, data); err != nil {
		return p.archiveError(err, p.compressed, p.decompressed)
	}
	if !githubTarballBlobMatches(data, expected.SHA) {
		return fail(5, "GitHub tarball file checksum differs from Git tree")
	}
	p.files[rel] = data
	p.expectedSeen[rel] = struct{}{}
	p.selectedTotal += int64(len(data))
	p.selectedCount++
	if expected.Mode == "100755" || h.Mode&0111 != 0 || fileMode(rel) == 0755 {
		p.executables[rel] = struct{}{}
	}
	return nil
}

func (p *githubTarballParser) selectedPath(name string) (bool, string) {
	if name == p.packagePrefix {
		return true, ""
	}
	prefix := p.packagePrefix + "/"
	if !strings.HasPrefix(name, prefix) {
		return false, ""
	}
	return true, strings.TrimPrefix(name, prefix)
}

func (p *githubTarballParser) selectedAncestor(name string) bool {
	return p.packagePrefix != p.archiveRoot && strings.HasPrefix(p.packagePrefix, name+"/")
}

func (p *githubTarballParser) addSelected(name string, dir bool) error {
	key := portablePathKey(name)
	if _, exists := p.selectedEntries[key]; exists {
		return fail(5, "GitHub tarball contains duplicate paths")
	}
	if err := p.selectedPortable.add(name, dir); err != nil {
		return err
	}
	p.selectedEntries[key] = struct{}{}
	return nil
}

func (p *githubTarballParser) finish() error {
	for name := range p.expectedFiles {
		if _, ok := p.expectedSeen[name]; !ok {
			return fail(5, "GitHub tarball is missing an expected file")
		}
	}
	return nil
}

func (p *githubTarballParser) archiveError(err error, compressed, decompressed *githubTarballLimitReader) error {
	if errors.Is(err, errGitHubTarballCompressedLimit) || compressed != nil && compressed.n > compressed.limit {
		limit := githubMaxCompressedBytes
		if compressed != nil {
			limit = compressed.limit
		}
		return githubRepositoryLimitError("compressed", limit)
	}
	if errors.Is(err, errGitHubTarballDecompressedLimit) || decompressed != nil && decompressed.n > decompressed.limit {
		limit := githubMaxDecompressedBytes
		if decompressed != nil {
			limit = decompressed.limit
		}
		return githubRepositoryLimitError("decompressed", limit)
	}
	if errors.Is(err, gzip.ErrChecksum) {
		return fail(5, "GitHub tarball checksum mismatch")
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return fail(8, "GitHub tarball download timed out")
	}
	return fail(5, "GitHub tarball is invalid")
}

func validateGitHubTarballExpected(expected map[string]githubTreeEntry) (map[string]githubTreeEntry, map[string]githubTreeEntry, error) {
	files := make(map[string]githubTreeEntry, len(expected))
	dirs := make(map[string]githubTreeEntry)
	portable := portablePaths{}
	for name, entry := range expected {
		if name == "" {
			if entry.Type != "tree" || entry.Mode != "040000" {
				return nil, nil, fail(5, "GitHub tree contains an invalid directory")
			}
			continue
		}
		if _, err := safePackagePath(name); err != nil {
			return nil, nil, err
		}
		if err := portable.add(name, entry.Type == "tree"); err != nil {
			return nil, nil, err
		}
		if err := validateGitHubTreeEntry(entry); err != nil {
			return nil, nil, err
		}
		switch entry.Type {
		case "tree":
			dirs[name] = entry
		case "blob":
			files[name] = entry
		default:
			return nil, nil, fail(5, "GitHub tree contains an unsupported entry")
		}
	}
	return files, dirs, nil
}

func githubTarballHasSparse(h *tar.Header) bool {
	if h.Typeflag == tar.TypeGNUSparse {
		return true
	}
	for key := range h.PAXRecords {
		if strings.HasPrefix(key, "GNU.sparse.") || strings.HasPrefix(key, "SCHILY.sparse.") {
			return true
		}
	}
	return false
}

func githubTarballBlobMatches(data []byte, expected string) bool {
	h := sha1.New()
	_, _ = h.Write([]byte("blob "))
	_, _ = h.Write([]byte(strconv.FormatInt(int64(len(data)), 10)))
	_, _ = h.Write([]byte{0})
	_, _ = h.Write(data)
	return strings.EqualFold(fmt.Sprintf("%x", h.Sum(nil)), expected)
}

func portablePathKey(name string) string {
	// portablePaths uses the same normalization and case folding for collision
	// checks. Keeping this key local makes exact duplicate directories fail too.
	return strings.ToLower(norm.NFC.String(name))
}

func githubRepositoryLimitError(kind string, limit int64) error {
	return fail(5, fmt.Sprintf("GitHub tarball exceeds the %s size limit (%d bytes, fixed repository safety cap); use a smaller repository or publish the skill separately. --max-skill-size only raises the selected skill limit", kind, limit))
}
