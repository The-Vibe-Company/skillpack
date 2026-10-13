package cli

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
)

func (c *client) publicNode(token, version string) (installNode, error) {
	n := installNode{}
	if !validSegment(token) || !validSegment(version) {
		return n, fail(2, "public install requires a share token and exact --version")
	}
	body, err := c.request("GET", "/public/skills/"+token, nil, "", 1<<20)
	if err != nil {
		return n, err
	}
	var preview struct {
		Slug    string `json:"slug"`
		Release *struct {
			Version  string `json:"version"`
			Checksum string `json:"checksum"`
			Size     int64  `json:"size_bytes"`
		} `json:"public_release"`
	}
	if json.Unmarshal(body, &preview) != nil || !skillName.MatchString(preview.Slug) || preview.Release == nil || preview.Release.Version != version {
		return n, fail(6, "public release was withdrawn or changed; inspect the current public page")
	}
	release := preview.Release
	if release.Size <= 0 || release.Size > maxPackageBytes*2 {
		return n, fail(5, "invalid public release size")
	}
	archive, err := c.request("GET", "/public/skills/"+token+"/versions/"+version+"/package", nil, "", release.Size)
	if err != nil {
		return n, err
	}
	digest := sha256.Sum256(archive)
	if int64(len(archive)) != release.Size || "sha256:"+hex.EncodeToString(digest[:]) != release.Checksum {
		return n, fail(5, "public package checksum mismatch")
	}
	files, err := readPackage(archive)
	if err != nil {
		return n, err
	}
	name, err := validatePackage(files)
	if err != nil {
		return n, err
	}
	if name != preview.Slug {
		return n, fail(5, "public package identity mismatch")
	}
	_, hash, err := canonicalPackage(files)
	if err != nil {
		return n, err
	}
	var manifest struct {
		Metadata struct {
			ID string `json:"companionSkillId"`
		} `json:"metadata"`
	}
	_ = json.Unmarshal(files["companion.json"], &manifest)
	return installNode{Slug: name, Version: version, Checksum: hash, Files: files, ID: manifest.Metadata.ID}, nil
}

// catalogNode resolves the validated release, then verifies its exact frozen ZIP before activation.
func (c *client) catalogNode(reference, version string) (installNode, error) {
	n := installNode{}
	parts := strings.Split(reference, "/")
	if len(parts) != 2 || !skillName.MatchString(parts[0]) || !skillName.MatchString(parts[1]) {
		return n, fail(2, "catalog install requires org/slug")
	}
	path := "/public/catalog/skills/" + reference
	body, err := c.request("GET", path, nil, "", 4<<20)
	if err != nil {
		return n, err
	}
	var release struct {
		Org      string `json:"org_slug"`
		Slug     string `json:"skill_slug"`
		Version  string `json:"version"`
		Checksum string `json:"checksum"`
		Size     int64  `json:"size_bytes"`
	}
	if json.Unmarshal(body, &release) != nil || release.Org != parts[0] || release.Slug != parts[1] || !validSegment(release.Version) {
		return n, fail(5, "invalid catalog release identity")
	}
	if version != "" && release.Version != version {
		return n, fail(6, "requested version is not the validated catalog release")
	}
	if release.Size <= 0 || release.Size > maxPackageBytes*2 {
		return n, fail(5, "invalid catalog release size")
	}
	archive, err := c.request("GET", path+"/versions/"+release.Version+"/package", nil, "", release.Size)
	if err != nil {
		return n, err
	}
	digest := sha256.Sum256(archive)
	if int64(len(archive)) != release.Size || "sha256:"+hex.EncodeToString(digest[:]) != release.Checksum {
		return n, fail(5, "catalog package checksum mismatch")
	}
	files, err := readPackage(archive)
	if err != nil {
		return n, err
	}
	name, err := validatePackage(files)
	if err != nil {
		return n, err
	}
	if name != release.Slug {
		return n, fail(5, "catalog package identity mismatch")
	}
	_, hash, err := canonicalPackage(files)
	if err != nil {
		return n, err
	}
	var manifest struct {
		Metadata struct {
			ID string `json:"companionSkillId"`
		} `json:"metadata"`
	}
	_ = json.Unmarshal(files["companion.json"], &manifest)
	return installNode{Slug: name, Version: release.Version, Checksum: hash, Files: files, ID: manifest.Metadata.ID}, nil
}
