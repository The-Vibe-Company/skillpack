package cli

import (
	"encoding/json"
	"github.com/google/uuid"
	"os"
	"path/filepath"
)

type replacement struct {
	Root    string `json:"root"`
	Target  string `json:"target"`
	Stage   string `json:"stage"`
	Backup  string `json:"backup"`
	Existed bool   `json:"existed"`
}
type transaction struct {
	State   string        `json:"state"`
	Entries []replacement `json:"entries"`
}

func noSymlinkPath(root, path string) error {
	root, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == ".." || len(rel) > 3 && rel[:3] == ".."+string(filepath.Separator) {
		return fail(5, "destination escapes its root")
	}
	current := path
	for {
		if info, err := os.Lstat(current); err == nil {
			if info.Mode()&os.ModeSymlink != 0 {
				return fail(5, "destination contains a symbolic link")
			}
		} else if !os.IsNotExist(err) {
			return err
		}
		if current == root {
			break
		}
		parent := filepath.Dir(current)
		if parent == current {
			return fail(5, "destination root is invalid")
		}
		current = parent
	}
	return nil
}
func (a *app) recoverTransaction() error {
	marker := filepath.Join(a.home, "transaction.json")
	b, err := os.ReadFile(marker)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var tx transaction
	if json.Unmarshal(b, &tx) != nil {
		return fail(6, "installation journal invalid; preserve files and inspect before retrying")
	}
	for i := len(tx.Entries) - 1; i >= 0; i-- {
		r := tx.Entries[i]
		if !filepath.IsAbs(r.Root) || !filepath.IsAbs(r.Target) || filepath.Dir(r.Stage) != filepath.Dir(r.Target) || filepath.Dir(r.Backup) != filepath.Dir(r.Target) || filepath.Base(r.Stage) == filepath.Base(r.Target) || filepath.Base(r.Backup) == filepath.Base(r.Target) {
			return fail(6, "installation journal paths invalid")
		}
		if err := noSymlinkPath(r.Root, r.Target); err != nil {
			return err
		}
		if tx.State != "committed" {
			if _, err := os.Lstat(r.Backup); err == nil {
				if err = os.RemoveAll(r.Target); err != nil {
					return err
				}
				if err = os.Rename(r.Backup, r.Target); err != nil {
					return err
				}
			} else if !r.Existed {
				if _, err := os.Lstat(r.Stage); os.IsNotExist(err) {
					if err = os.RemoveAll(r.Target); err != nil {
						return err
					}
				}
			}
		}
		if err := os.RemoveAll(r.Stage); err != nil {
			return err
		}
		if err := os.RemoveAll(r.Backup); err != nil {
			return err
		}
	}
	if err := os.Remove(marker); err != nil {
		return err
	}
	syncDir(a.home)
	return nil
}
func stageFile(target string, body []byte, private bool) (replacement, error) {
	r := replacement{Root: filepath.Dir(target), Target: target, Backup: filepath.Join(filepath.Dir(target), ".skillpack-backup-"+uuid.NewString())}
	if info, err := os.Lstat(target); err == nil {
		if !info.Mode().IsRegular() {
			return r, fail(6, "file destination is not regular")
		}
		r.Existed = true
	} else if !os.IsNotExist(err) {
		return r, err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return r, err
	}
	f, err := os.CreateTemp(filepath.Dir(target), ".skillpack-stage-")
	if err != nil {
		return r, err
	}
	r.Stage = f.Name()
	mode := os.FileMode(0644)
	if private {
		mode = 0600
	}
	if err = f.Chmod(mode); err == nil && private {
		err = protectPath(r.Stage, false)
	}
	if err == nil {
		_, err = f.Write(body)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(r.Stage)
	}
	return r, err
}
func stageDirectory(target string, files map[string][]byte) (replacement, error) {
	r := replacement{Root: filepath.Dir(target), Target: target, Backup: filepath.Join(filepath.Dir(target), ".skillpack-backup-"+uuid.NewString())}
	if info, err := os.Lstat(target); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return r, fail(6, "package destination is redirected")
		}
		r.Existed = true
	} else if !os.IsNotExist(err) {
		return r, err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return r, err
	}
	stage, err := os.MkdirTemp(filepath.Dir(target), ".skillpack-stage-")
	if err != nil {
		return r, err
	}
	r.Stage = stage
	if err = writePackage(stage, files); err != nil {
		os.RemoveAll(stage)
		return r, err
	}
	return r, nil
}
func (a *app) commitTransaction(entries []replacement) error {
	if len(entries) == 0 {
		return nil
	}
	tx := transaction{"applying", entries}
	b, _ := json.Marshal(tx)
	marker := filepath.Join(a.home, "transaction.json")
	if err := writePrivate(marker, b); err != nil {
		return err
	}
	for _, r := range entries {
		if err := noSymlinkPath(r.Root, r.Target); err != nil {
			_ = a.recoverTransaction()
			return err
		}
		if r.Existed {
			if err := os.Rename(r.Target, r.Backup); err != nil {
				_ = a.recoverTransaction()
				return err
			}
		}
		if err := os.Rename(r.Stage, r.Target); err != nil {
			_ = a.recoverTransaction()
			return err
		}
		syncDir(filepath.Dir(r.Target))
	}
	tx.State = "committed"
	b, _ = json.Marshal(tx)
	if err := writePrivate(marker, b); err != nil {
		_ = a.recoverTransaction()
		return err
	}
	return a.recoverTransaction()
}

// Leave staged files in place when recovery still owns them.
func (a *app) discardUncommitted(entries *[]replacement) {
	if _, err := os.Lstat(filepath.Join(a.home, "transaction.json")); !os.IsNotExist(err) {
		return
	}
	for _, r := range *entries {
		_ = os.RemoveAll(r.Stage)
	}
}
