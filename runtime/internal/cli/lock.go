package cli

import (
	"os"
	"path/filepath"
	"time"
)

// Use a real OS lock: killed processes release ownership without unsafe stale-PID guesses.
func acquireLock(path string) (func(), error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	if info, err := os.Lstat(path); err == nil && !info.Mode().IsRegular() {
		return nil, fail(6, "refusing redirected lock file")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = protectPath(path, false); err != nil {
		f.Close()
		return nil, err
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		if err = lockFile(f); err == nil {
			return func() { unlockFile(f); f.Close() }, nil
		}
		if time.Now().After(deadline) {
			f.Close()
			return nil, fail(6, "another Skillpack operation owns this lock; retry after it finishes")
		}
		time.Sleep(50 * time.Millisecond)
	}
}
