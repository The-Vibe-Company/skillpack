package cli

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"testing"
)

func TestReleaseSignatureBindsEveryArchiveAndRejectsTampering(t *testing.T) {
	pub, private, _ := ed25519.GenerateKey(rand.Reader)
	der, _ := x509.MarshalPKIXPublicKey(pub)
	key := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})
	manifest := releaseManifest{Schema: 1, Protocol: 1, Version: "0.2.0"}
	for _, target := range []string{"darwin_amd64", "darwin_arm64", "linux_amd64", "linux_arm64", "windows_amd64", "windows_arm64"} {
		suffix := ".tar.gz"
		if target[:7] == "windows" {
			suffix = ".zip"
		}
		name := "skillpack-runtime_0.2.0_" + target + suffix
		manifest.Assets = append(manifest.Assets, releaseAsset{Target: target, Name: name, URL: "https://example.com/release/" + name, Size: 100, SHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"})
	}
	body, _ := json.Marshal(manifest)
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(private, body))
	if _, err := verifyRelease(body, signature, string(key), "0.2.0", "https://example.com/release"); err != nil {
		t.Fatal(err)
	}
	body[len(body)-2] ^= 1
	if _, err := verifyRelease(body, signature, string(key), "0.2.0", "https://example.com/release"); err == nil {
		t.Fatal("tampered release accepted")
	}
	body, _ = json.Marshal(manifest)
	manifest.Assets = manifest.Assets[:5]
	incomplete, _ := json.Marshal(manifest)
	if _, err := verifyRelease(incomplete, base64.StdEncoding.EncodeToString(ed25519.Sign(private, incomplete)), string(key), "0.2.0", "https://example.com/release"); err == nil {
		t.Fatal("incomplete release accepted")
	}
	if _, err := verifyRelease(body, signature, string(key), "0.3.0", "https://example.com/release"); err == nil {
		t.Fatal("wrong version accepted")
	}
}
