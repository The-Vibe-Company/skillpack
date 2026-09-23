package cli

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	usage "github.com/The-Vibe-Company/skillpack/runtime/internal/runtime"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

//go:embed contracts/runtime-release.json
var releaseConfiguration []byte
var releaseVersion = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

type releaseAsset struct {
	Target string `json:"target"`
	Name   string `json:"name"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
type releaseManifest struct {
	Schema   int            `json:"schemaVersion"`
	Protocol int            `json:"protocolVersion"`
	Version  string         `json:"version"`
	Assets   []releaseAsset `json:"assets"`
}

func verifyRelease(body []byte, signature, key, version, base string) (releaseManifest, error) {
	var manifest releaseManifest
	block, _ := pem.Decode([]byte(key))
	if block == nil {
		return manifest, fail(5, "release signing key invalid")
	}
	public, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return manifest, fail(5, "release signing key invalid")
	}
	ed, ok := public.(ed25519.PublicKey)
	if !ok {
		return manifest, fail(5, "release signing algorithm invalid")
	}
	sig, err := base64.StdEncoding.DecodeString(strings.TrimSpace(signature))
	if err != nil || !ed25519.Verify(ed, body, sig) {
		return manifest, fail(5, "release signature invalid")
	}
	if json.Unmarshal(body, &manifest) != nil || manifest.Schema != 1 || manifest.Protocol != 1 || manifest.Version != version || !releaseVersion.MatchString(version) || len(manifest.Assets) != 6 {
		return manifest, fail(5, "release contract invalid or incomplete")
	}
	expected := map[string]bool{}
	for _, system := range []string{"darwin", "linux", "windows"} {
		for _, arch := range []string{"amd64", "arm64"} {
			expected[system+"_"+arch] = true
		}
	}
	for _, asset := range manifest.Assets {
		if !expected[asset.Target] {
			return manifest, fail(5, "release target duplicated or unsupported")
		}
		delete(expected, asset.Target)
		suffix := ".tar.gz"
		if strings.HasPrefix(asset.Target, "windows_") {
			suffix = ".zip"
		}
		name := "skillpack-runtime_" + version + "_" + asset.Target + suffix
		digest, err := hex.DecodeString(asset.SHA256)
		if asset.Name != name || asset.URL != base+"/"+name || asset.Size <= 0 || asset.Size > 128<<20 || err != nil || len(digest) != 32 {
			return manifest, fail(5, "release archive metadata invalid")
		}
	}
	return manifest, nil
}
func publicDownload(raw string, limit int64) ([]byte, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return nil, fail(5, "distribution requires an HTTPS URL")
	}
	client := http.Client{Timeout: 60 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 5 || req.URL.Scheme != "https" || req.URL.User != nil {
			return fail(5, "distribution redirect rejected")
		}
		return nil
	}}
	resp, err := client.Get(raw)
	if err != nil {
		return nil, fail(8, "release download failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fail(8, "release unavailable")
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil || int64(len(b)) > limit {
		return nil, fail(8, "release download incomplete or oversized")
	}
	return b, nil
}
func newerVersion(a, b string) bool {
	if !releaseVersion.MatchString(a) || !releaseVersion.MatchString(b) {
		return false
	}
	aa := strings.Split(a, ".")
	bb := strings.Split(b, ".")
	for i := range aa {
		x, _ := strconv.ParseUint(aa[i], 10, 64)
		y, _ := strconv.ParseUint(bb[i], 10, 64)
		if x != y {
			return x > y
		}
	}
	return false
}
func extractRelease(data []byte, zipped bool) (map[string][]byte, error) {
	files := map[string][]byte{}
	var total int64
	add := func(name string, size int64, reader io.Reader) error {
		allowed := name == "skillpack" || name == "skillpack.exe" || name == "skillpack-runtime" || name == "skillpack-runtime.exe" || name == "LICENSE" || name == "NOTICE" || name == "SOURCE.json"
		if !allowed || files[name] != nil || size < 0 || size > 128<<20 || total+size > 256<<20 {
			return fail(5, "unexpected release archive entry")
		}
		b, err := io.ReadAll(io.LimitReader(reader, size+1))
		if err != nil || int64(len(b)) != size {
			return fail(5, "incomplete release archive entry")
		}
		files[name] = b
		total += size
		return nil
	}
	if zipped {
		r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return nil, err
		}
		for _, file := range r.File {
			if !file.Mode().IsRegular() {
				return nil, fail(5, "special release archive entry")
			}
			reader, err := file.Open()
			if err != nil {
				return nil, err
			}
			err = add(file.Name, int64(file.UncompressedSize64), reader)
			reader.Close()
			if err != nil {
				return nil, err
			}
		}
	} else {
		gz, err := gzip.NewReader(bytes.NewReader(data))
		if err != nil {
			return nil, err
		}
		defer gz.Close()
		reader := tar.NewReader(io.LimitReader(gz, 260<<20))
		for {
			header, err := reader.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				return nil, err
			}
			if header.Typeflag != tar.TypeReg {
				return nil, fail(5, "special release archive entry")
			}
			if err = add(header.Name, header.Size, reader); err != nil {
				return nil, err
			}
		}
	}
	binary := "skillpack"
	if zipped {
		binary += ".exe"
	}
	runtimeBinary := "skillpack-runtime"
	if zipped {
		runtimeBinary += ".exe"
	}
	if len(files[binary]) == 0 || len(files[runtimeBinary]) == 0 {
		return nil, fail(5, "release does not contain both native binaries")
	}
	return files, nil
}
func (a *app) selfUpdate() (any, error) {
	if err := recoverNativeActivation(a.home); err != nil {
		return nil, err
	}
	if len(a.options.args) != 2 || a.options.args[1] != "update" {
		return nil, fail(2, "use self update [--version x.y.z]")
	}
	var configuration struct {
		PublicKey string `json:"publicKey"`
		Version   string `json:"version"`
	}
	if json.Unmarshal(releaseConfiguration, &configuration) != nil {
		return nil, fail(5, "invalid embedded release configuration")
	}
	version := a.options.values["version"]
	if version == "" {
		body, err := publicDownload("https://api.github.com/repos/The-Vibe-Company/skillpack/releases?per_page=100", 2<<20)
		if err != nil {
			return nil, err
		}
		var releases []struct {
			Tag        string `json:"tag_name"`
			Draft      bool   `json:"draft"`
			Prerelease bool   `json:"prerelease"`
		}
		if json.Unmarshal(body, &releases) != nil {
			return nil, fail(8, "invalid release catalog")
		}
		version = usage.RuntimeVersion
		for _, release := range releases {
			candidate := strings.TrimPrefix(release.Tag, "runtime-v")
			if !release.Draft && !release.Prerelease && strings.HasPrefix(release.Tag, "runtime-v") && newerVersion(candidate, version) {
				version = candidate
			}
		}
	}
	if !releaseVersion.MatchString(version) {
		return nil, fail(2, "invalid release version")
	}
	if newerVersion(usage.RuntimeVersion, version) {
		return nil, fail(6, "self update refuses a downgrade")
	}
	if version == usage.RuntimeVersion {
		return map[string]any{"status": "current", "version": version}, nil
	}
	base := "https://github.com/The-Vibe-Company/skillpack/releases/download/runtime-v" + version
	body, err := publicDownload(base+"/manifest.json", 65536)
	if err != nil {
		return nil, err
	}
	signature, err := publicDownload(base+"/manifest.sig", 1024)
	if err != nil {
		return nil, err
	}
	manifest, err := verifyRelease(body, string(signature), configuration.PublicKey, version, base)
	if err != nil {
		return nil, err
	}
	var selected releaseAsset
	for _, asset := range manifest.Assets {
		if asset.Target == runtime.GOOS+"_"+runtime.GOARCH {
			selected = asset
		}
	}
	if selected.Name == "" {
		return nil, fail(5, "unsupported native target")
	}
	if a.options.flags["dry-run"] {
		return map[string]any{"status": "available", "version": version, "signatureVerified": true}, nil
	}
	archive, err := publicDownload(selected.URL, selected.Size)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(archive)
	if int64(len(archive)) != selected.Size || hex.EncodeToString(hash[:]) != selected.SHA256 {
		return nil, fail(5, "release archive checksum mismatch")
	}
	files, err := extractRelease(archive, runtime.GOOS == "windows")
	if err != nil {
		return nil, err
	}
	cliRoot, err := secureSubdir(a.home, "cli")
	if err != nil {
		return nil, err
	}
	unlock, err := acquireLock(filepath.Join(a.home, ".mutation.lock"))
	if err != nil {
		return nil, err
	}
	defer unlock()
	if err = a.recoverTransaction(); err != nil {
		return nil, err
	}
	receiptPath := filepath.Join(cliRoot, "install.json")
	raw, err := os.ReadFile(receiptPath)
	if err != nil {
		return nil, fail(6, "self update requires an official installer receipt")
	}
	receipt := map[string]any{}
	if json.Unmarshal(raw, &receipt) != nil {
		return nil, fail(6, "invalid native installation receipt")
	}
	executable, ok := receipt["executablePath"].(string)
	if !ok || !filepath.IsAbs(executable) {
		return nil, fail(6, "invalid managed executable path")
	}
	destination := filepath.Join(cliRoot, "versions", version)
	if err = noSymlinkPath(cliRoot, destination); err != nil {
		return nil, err
	}

	binary := "skillpack"
	runtimeBinary := "skillpack-runtime"
	if runtime.GOOS == "windows" {
		binary += ".exe"
		runtimeBinary += ".exe"
	}
	if info, e := os.Lstat(destination); e == nil {
		if !info.IsDir() {
			return nil, fail(6, "managed version slot is not a directory")
		}
		for _, name := range []string{binary, runtimeBinary} {
			old, e := os.ReadFile(filepath.Join(destination, name))
			if e != nil || !bytes.Equal(old, files[name]) {
				return nil, fail(6, "existing version slot differs from signed archive")
			}
		}
	} else if !os.IsNotExist(e) {
		return nil, e
	} else {
		r, err := stageDirectory(destination, files)
		if err != nil {
			return nil, err
		}
		r.Root = cliRoot
		rows := []replacement{r}
		defer a.discardUncommitted(&rows)
		for _, name := range []string{binary, runtimeBinary} {
			if err = os.Chmod(filepath.Join(r.Stage, name), 0755); err != nil {
				return nil, err
			}
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		output, err := exec.CommandContext(ctx, filepath.Join(r.Stage, binary), "--version").Output()
		if err != nil || strings.TrimSpace(string(output)) != "skillpack "+version {
			return nil, fail(5, "new native binary self-test failed")
		}
		if err = a.commitTransaction(rows); err != nil {
			return nil, err
		}
	}
	receipt["previousVersion"] = usage.RuntimeVersion
	receipt["version"] = version
	receipt["binaryPath"] = filepath.Join(destination, binary)
	receipt["binarySha256"] = digestBytes(files[binary])
	receipt["runtimeSha256"] = digestBytes(files[runtimeBinary])
	receipt["runtimeExecutablePath"] = filepath.Join(destination, runtimeBinary)
	nextReceipt, _ := json.Marshal(receipt)
	activation, err := activateNative(executable, filepath.Join(destination, binary), receiptPath, nextReceipt)
	if err != nil {
		return nil, err
	}
	return map[string]any{"status": activation, "version": version, "executablePath": executable, "restartRequired": true}, nil
}

func digestBytes(b []byte) string { sum := sha256.Sum256(b); return fmt.Sprintf("%x", sum) }
