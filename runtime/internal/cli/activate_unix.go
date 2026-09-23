//go:build !windows

package cli

import (
	"encoding/json"
	"github.com/google/uuid"
	"os"
	"path/filepath"
	"strings"
)

func activateNative(executable, binary, receipt string, body []byte) (string, error) {
	current, err := os.Readlink(executable)
	if err != nil {
		return "", fail(6, "stable CLI path is not an installer-owned symlink")
	}
	versions := filepath.Join(filepath.Dir(receipt), "versions")
	if !filepath.IsAbs(current) {
		current = filepath.Join(filepath.Dir(executable), current)
	}
	relative, err := filepath.Rel(versions, current)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fail(6, "stable CLI points outside managed version slots")
	}
	marker := filepath.Join(filepath.Dir(receipt), "activation-receipt.json")
	job := nativeActivation{Executable: executable, Binary: binary, Receipt: receipt, Body: body}
	encoded, _ := json.Marshal(job)
	if err = writePrivate(marker, encoded); err != nil {
		return "", err
	}
	staged := executable + ".skillpack-next-" + uuid.NewString()
	if err = os.Symlink(binary, staged); err != nil {
		return "", err
	}
	defer os.Remove(staged)
	if err = os.Rename(staged, executable); err != nil {
		return "", err
	}
	syncDir(filepath.Dir(executable))
	if err := writePrivate(receipt, body); err != nil {
		return "", err
	}
	if err = os.Remove(marker); err != nil {
		return "", err
	}
	return "updated", nil
}

func activateWorker(string) int { return 2 }

// Recover the receipt when the process stopped after switching the launcher.
// Version slots remain immutable, so either launcher always names a usable binary.
type nativeActivation struct {
	Executable string          `json:"executable"`
	Binary     string          `json:"binary"`
	Receipt    string          `json:"receipt"`
	Body       json.RawMessage `json:"body"`
}

func recoverNativeActivation(home string) error {
	root := filepath.Join(home, "cli")
	marker := filepath.Join(root, "activation-receipt.json")
	data, err := os.ReadFile(marker)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var job nativeActivation
	if json.Unmarshal(data, &job) != nil || job.Receipt != filepath.Join(root, "install.json") || !filepath.IsAbs(job.Executable) || noSymlinkPath(filepath.Join(root, "versions"), job.Binary) != nil {
		return fail(6, "invalid native activation journal")
	}
	oldData, err := os.ReadFile(job.Receipt)
	if err != nil {
		return err
	}
	var old struct {
		Executable string `json:"executablePath"`
	}
	if json.Unmarshal(oldData, &old) != nil || old.Executable != job.Executable {
		return fail(6, "activation journal does not match receipt")
	}
	current, err := os.Readlink(job.Executable)
	if err != nil {
		return err
	}
	if !filepath.IsAbs(current) {
		current = filepath.Join(filepath.Dir(job.Executable), current)
	}
	if current == job.Binary {
		if err = writePrivate(job.Receipt, job.Body); err != nil {
			return err
		}
	}
	return os.Remove(marker)
}
