package cli

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"golang.org/x/text/unicode/norm"
	"gopkg.in/yaml.v3"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const maxPackageBytes = 25 << 20
const maxFileBytes = 10 << 20
const maxPackageFiles = 2000

var reservedName = regexp.MustCompile(`(?i)^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$`)
var skillName = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

//go:embed contracts/manifest.schema.json
var manifestSchema []byte

func safePackagePath(name string) (string, error) {
	if !utf8.ValidString(name) || strings.HasPrefix(name, "/") || strings.Contains(name, "\\") {
		return "", fail(5, "unsafe archive path")
	}
	name = strings.TrimSuffix(name, "/")
	if name == "" {
		return "", fail(5, "empty archive path")
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." || strings.TrimRight(part, " .") != part {
			return "", fail(5, "unsafe archive path")
		}
		for _, r := range part {
			if r < 32 || strings.ContainsRune(`<>:"|?*`, r) {
				return "", fail(5, "archive path is not portable")
			}
		}
		if reservedName.MatchString(strings.SplitN(part, ".", 2)[0]) {
			return "", fail(5, "archive uses a reserved filename")
		}
	}
	return name, nil
}
func excludedPackagePath(path string) bool {
	for _, p := range strings.Split(path, "/") {
		switch p {
		case ".git", ".DS_Store", "__MACOSX", "node_modules", "__pycache__", ".companion", ".companion.lock", "companion.lock":
			return true
		}
		if strings.HasSuffix(p, ".pyc") {
			return true
		}
	}
	return false
}
func fileMode(name string) int64 {
	if strings.HasPrefix(name, "scripts/") || strings.Contains(name, "/scripts/") {
		return 0755
	}
	return 0644
}
func digest(b []byte) string { sum := sha256.Sum256(b); return "sha256:" + hex.EncodeToString(sum[:]) }

type portablePaths map[string]struct {
	name string
	dir  bool
}

func (p portablePaths) add(name string, dir bool) error {
	parts := strings.Split(name, "/")
	for i := range parts {
		display := strings.Join(parts[:i+1], "/")
		key := strings.ToLower(norm.NFC.String(display))
		directory := i < len(parts)-1 || dir
		if prior, ok := p[key]; ok && (prior.name != display || prior.dir != directory || !directory) {
			return fail(5, "duplicate or colliding archive path")
		}
		p[key] = struct {
			name string
			dir  bool
		}{display, directory}
	}
	return nil
}
func scanPackage(root string) (map[string][]byte, error) {
	files := map[string][]byte{}
	seen := portablePaths{}
	total := 0
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			if !d.IsDir() {
				return fail(5, "package root must be a directory")
			}
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if excludedPackagePath(rel) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err = safePackagePath(rel)
		if err != nil {
			return err
		}
		if err = seen.add(rel, d.IsDir()); err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fail(5, "packages cannot contain symbolic links or special files")
		}
		if info.Size() > maxFileBytes || total+int(info.Size()) > maxPackageBytes || len(files) >= maxPackageFiles {
			return fail(5, "package exceeds size or entry limit")
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		total += len(b)
		if total > maxPackageBytes || len(b) > maxFileBytes {
			return fail(5, "package changed beyond size limit")
		}
		files[rel] = b
		return nil
	})
	return files, err
}

func readPackage(data []byte) (map[string][]byte, error) {
	if len(data) > maxPackageBytes*2 {
		return nil, fail(5, "archive exceeds size limit")
	}
	files := map[string][]byte{}
	seen := portablePaths{}
	total, count := int64(0), 0
	add := func(raw string, size int64, dir bool, r io.Reader) error {
		count++
		if count > maxPackageFiles || size < 0 || size > maxFileBytes || total+size > maxPackageBytes {
			return fail(5, "archive exceeds size or entry limit")
		}
		name, err := safePackagePath(raw)
		if err != nil {
			return err
		}
		if err = seen.add(name, dir); err != nil {
			return err
		}
		if dir {
			return nil
		}
		b, err := io.ReadAll(io.LimitReader(r, maxFileBytes+1))
		if err != nil || len(b) > maxFileBytes || int64(len(b)) != size {
			return fail(5, "archive entry is invalid or oversized")
		}
		total += int64(len(b))
		files[name] = b
		return nil
	}
	if len(data) >= 4 && bytes.Equal(data[:2], []byte("PK")) {
		z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return nil, fail(5, "invalid ZIP archive")
		}
		for _, f := range z.File {
			if f.Mode()&os.ModeType != 0 && !f.FileInfo().IsDir() {
				return nil, fail(5, "archive contains links or special entries")
			}
			r, err := f.Open()
			if err != nil {
				return nil, err
			}
			err = add(f.Name, int64(f.UncompressedSize64), f.FileInfo().IsDir(), r)
			r.Close()
			if err != nil {
				return nil, err
			}
		}
	} else {
		var r io.Reader = bytes.NewReader(data)
		if len(data) > 2 && data[0] == 0x1f && data[1] == 0x8b {
			g, err := gzip.NewReader(r)
			if err != nil {
				return nil, fail(5, "invalid compressed archive")
			}
			defer g.Close()
			r = io.LimitReader(g, maxPackageBytes*2+1)
		}
		t := tar.NewReader(r)
		for {
			h, err := t.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				return nil, fail(5, "invalid TAR archive")
			}
			if h.Typeflag != tar.TypeReg && h.Typeflag != tar.TypeRegA && h.Typeflag != tar.TypeDir {
				return nil, fail(5, "archive contains links or special entries")
			}
			if err = add(h.Name, h.Size, h.Typeflag == tar.TypeDir, t); err != nil {
				return nil, err
			}
		}
	}
	if _, ok := files["SKILL.md"]; !ok {
		prefix := ""
		for name := range files {
			if strings.Count(name, "/") == 1 && strings.HasSuffix(name, "/SKILL.md") {
				if prefix != "" {
					return nil, fail(5, "ambiguous package root")
				}
				prefix = strings.TrimSuffix(name, "SKILL.md")
			}
		}
		if prefix == "" {
			return nil, fail(5, "package is missing SKILL.md")
		}
		flat := map[string][]byte{}
		for name, b := range files {
			if !strings.HasPrefix(name, prefix) {
				return nil, fail(5, "files outside package root")
			}
			flat[strings.TrimPrefix(name, prefix)] = b
		}
		files = flat
	}
	return files, nil
}

// This is the published tar-stream canonical format, not archive/tar's different
// padding/PAX choices. The fixture generated by the TS packer is its independent oracle.
func canonicalHeader(name string, size, mode int64, kind byte) ([]byte, bool) {
	prefix := ""
	if !isASCII(name) {
		return nil, false
	}
	for len(name) > 100 {
		i := strings.IndexByte(name, '/')
		if i < 0 {
			return nil, false
		}
		if prefix != "" {
			prefix += "/"
		}
		prefix += name[:i]
		name = name[i+1:]
	}
	if len(prefix) > 155 {
		return nil, false
	}
	b := make([]byte, 512)
	copy(b, name)
	oct := func(offset, width int, n int64) {
		s := strconv.FormatInt(n, 8)
		copy(b[offset:], strings.Repeat("0", width-len(s))+s+" ")
	}
	oct(100, 6, mode)
	oct(108, 6, 0)
	oct(116, 6, 0)
	oct(124, 11, size)
	oct(136, 11, 0)
	b[156] = kind
	copy(b[257:], "ustar\x0000")
	oct(329, 6, 0)
	oct(337, 6, 0)
	copy(b[345:], prefix)
	sum := int64(8 * 32)
	for i, v := range b {
		if i < 148 || i >= 156 {
			sum += int64(v)
		}
	}
	oct(148, 6, sum)
	return b, true
}
func isASCII(s string) bool {
	for _, b := range []byte(s) {
		if b > 127 {
			return false
		}
	}
	return true
}
func canonicalPackage(files map[string][]byte) ([]byte, string, error) {
	if _, ok := files["SKILL.md"]; !ok {
		return nil, "", fail(5, "SKILL.md is required")
	}
	names := make([]string, 0, len(files))
	total := 0
	for name, b := range files {
		if _, err := safePackagePath(name); err != nil {
			return nil, "", err
		}
		if excludedPackagePath(name) {
			continue
		}
		if len(b) > maxFileBytes {
			return nil, "", fail(5, "package file too large")
		}
		total += len(b)
		names = append(names, name)
	}
	if total > maxPackageBytes || len(names) > maxPackageFiles {
		return nil, "", fail(5, "package too large")
	}
	sort.Strings(names)
	var out bytes.Buffer
	writeBody := func(b []byte) {
		out.Write(b)
		if pad := (512 - len(b)%512) % 512; pad > 0 {
			out.Write(make([]byte, pad))
		}
	}
	for _, name := range names {
		body := files[name]
		mode := fileMode(name)
		h, ok := canonicalHeader(name, int64(len(body)), mode, '0')
		if !ok {
			record := " path=" + name + "\n"
			n := len(record) + 1
			for {
				next := len(record) + len(strconv.Itoa(n))
				if next == n {
					break
				}
				n = next
			}
			pax := []byte(strconv.Itoa(n) + record)
			ph, _ := canonicalHeader("PaxHeader", int64(len(pax)), mode, 'x')
			out.Write(ph)
			writeBody(pax)
			h, _ = canonicalHeader("PaxHeader", int64(len(body)), mode, '0')
		}
		out.Write(h)
		writeBody(body)
	}
	out.Write(make([]byte, 1024))
	return out.Bytes(), digest(out.Bytes()), nil
}
func validatePackage(files map[string][]byte) (string, error) {
	return validatePackageKind(files, false)
}
func validatePackageKind(files map[string][]byte, management bool) (string, error) {
	skill := files["SKILL.md"]
	if len(skill) == 0 || len(skill) > 1<<20 {
		return "", fail(5, "SKILL.md is missing or oversized")
	}
	normalized := strings.ReplaceAll(string(skill), "\r\n", "\n")
	if !strings.HasPrefix(normalized, "---\n") {
		return "", fail(5, "SKILL.md needs YAML frontmatter")
	}
	end := strings.Index(normalized[4:], "\n---")
	if end < 0 {
		return "", fail(5, "unterminated YAML frontmatter")
	}
	var front map[string]any
	if yaml.Unmarshal([]byte(normalized[4:4+end]), &front) != nil {
		return "", fail(5, "invalid YAML frontmatter")
	}
	name, _ := front["name"].(string)
	description, _ := front["description"].(string)
	if !skillName.MatchString(name) || len(name) > 64 || strings.TrimSpace(description) == "" || len(description) > 1024 {
		return "", fail(5, "invalid skill name or description")
	}
	if raw, ok := files["companion.json"]; ok {
		var value, schema any
		if json.Unmarshal(raw, &value) != nil {
			return "", fail(5, "invalid companion.json")
		}
		if json.Unmarshal(manifestSchema, &schema) != nil {
			return "", fail(5, "invalid embedded manifest schema")
		}
		if management {
			manifest, ok := value.(map[string]any)
			if !ok || name != "skillpack" {
				return "", fail(5, "invalid management bundle")
			}
			if metadata, ok := manifest["metadata"].(map[string]any); ok {
				delete(metadata, "integrityFiles")
			}
		}
		compiler := jsonschema.NewCompiler()
		compiler.UseRegexpEngine(compileSchemaRegexp)
		if err := compiler.AddResource("https://skillpack.app/schemas/companion-manifest.v2.schema.json", schema); err != nil {
			return "", err
		}
		compiled, err := compiler.Compile("https://skillpack.app/schemas/companion-manifest.v2.schema.json")
		if err != nil {
			return "", err
		}
		if compiled.Validate(value) != nil {
			return "", fail(5, "companion.json does not satisfy the package contract")
		}
		m, _ := value.(map[string]any)
		if declared, ok := m["name"].(string); ok && declared != name {
			return "", fail(5, "manifest name differs from SKILL.md")
		}
	}
	return name, nil
}

func writePackage(dir string, files map[string][]byte) error {
	for name, b := range files {
		if _, err := safePackagePath(name); err != nil {
			return err
		}
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return err
		}
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, fs.FileMode(fileMode(name)))
		if err != nil {
			return err
		}
		if _, err = f.Write(b); err == nil {
			err = f.Sync()
		}
		closeErr := f.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		syncDir(filepath.Dir(path))
	}
	return nil
}

func packageZip(files map[string][]byte) ([]byte, error) {
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	names := make([]string, 0, len(files))
	for name := range files {
		if !excludedPackagePath(name) {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	for _, name := range names {
		h := &zip.FileHeader{Name: name, Method: zip.Deflate}
		h.SetMode(fs.FileMode(fileMode(name)))
		w, err := z.CreateHeader(h)
		if err != nil {
			return nil, err
		}
		if _, err = w.Write(files[name]); err != nil {
			return nil, err
		}
	}
	if err := z.Close(); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

func (a *app) publishPackage() (any, error) {
	args := a.options.args
	if len(args) != 3 {
		return nil, fail(2, "provide a package directory")
	}
	files, err := scanPackage(args[2])
	if err != nil {
		return nil, err
	}
	name, err := validatePackage(files)
	if err != nil {
		return nil, err
	}
	_, checksum, err := canonicalPackage(files)
	if err != nil {
		return nil, err
	}
	if args[1] == "validate" {
		return map[string]any{"valid": true, "name": name, "checksum": checksum, "files": len(files), "serverValidation": "performed during publication"}, nil
	}
	c, err := a.client()
	if err != nil {
		return nil, err
	}
	archive, err := packageZip(files)
	if err != nil {
		return nil, err
	}
	path := "/skills?action=publish"
	if v := a.options.values["version"]; v != "" {
		if !validSegment(v) {
			return nil, fail(2, "invalid version")
		}
		path += "&version=" + v
	}
	if scope := a.options.values["scope"]; scope != "" {
		if scope != "org" && scope != "personal" {
			return nil, fail(2, "publish scope must be org or personal")
		}
		path += "&scope=" + scope
	}
	if existing, err := c.json("GET", "/skills/"+name, nil); err == nil {
		row, ok := existing.(map[string]any)
		if !ok {
			return nil, fail(8, "unexpected skill response")
		}
		id, _ := row["id"].(string)
		if !validSegment(id) {
			return nil, fail(8, "missing publish target identity")
		}
		path += "&expect_slug=" + name + "&expect_skill_id=" + id
	} else {
		if ce, ok := err.(*commandError); !ok || ce.code != 4 {
			return nil, err
		}
	}
	b, err := c.request("POST", path, archive, "application/zip", 16<<20)
	if err != nil {
		return nil, err
	}
	var result any
	if json.Unmarshal(b, &result) != nil {
		return nil, fmt.Errorf("invalid publication result; inspect skill history before retrying")
	}
	return result, nil
}
