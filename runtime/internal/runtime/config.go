package runtime

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

var errInvalidStateDir = errors.New("runtime state directory must be a real directory path")

func resolveStateDir(override string) (string, error) {
	if strings.TrimSpace(override) != "" {
		return cleanStateDir(override)
	}
	if env := strings.TrimSpace(os.Getenv("SKILLPACK_RUNTIME_HOME")); env != "" {
		return cleanStateDir(env)
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return cleanStateDir(filepath.Join(base, "skillpack"))
}

func cleanStateDir(path string) (string, error) {
	if strings.IndexByte(path, 0) >= 0 {
		return "", errInvalidStateDir
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	return filepath.Clean(abs), nil
}

func ensurePrivateDir(path string) error {
	if info, err := os.Lstat(path); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return errInvalidStateDir
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(path, 0o700); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(path, 0o700); err != nil {
			return err
		}
	}
	return nil
}

func privateFileMode() os.FileMode { return 0o600 }

func telemetryDisabledForProcess() bool {
	return strings.TrimSpace(os.Getenv("SKILLPACK_TELEMETRY")) == "0"
}

func currentEnvironment() string {
	if strings.TrimSpace(os.Getenv("SKILLPACK_TELEMETRY_ENVIRONMENT")) != "" {
		if value := strings.TrimSpace(os.Getenv("SKILLPACK_TELEMETRY_ENVIRONMENT")); validEnvironments[value] {
			return value
		}
	}
	if os.Getenv("CI") != "" || os.Getenv("GITHUB_ACTIONS") != "" {
		return "ci"
	}
	if os.Getenv("CONDUCTOR_WORKSPACE") != "" || os.Getenv("CONDUCTOR_PORT") != "" {
		return "conductor"
	}
	if os.Getenv("SANDBOX") != "" || os.Getenv("CI_SANDBOX") != "" {
		return "sandbox"
	}
	return "local"
}

func configuredIdentity() *Identity {
	userID := strings.TrimSpace(os.Getenv("SKILLPACK_TELEMETRY_USER_ID"))
	email := strings.TrimSpace(os.Getenv("SKILLPACK_TELEMETRY_EMAIL"))
	if userID == "" && email == "" {
		return nil
	}
	return &Identity{UserID: userID, Email: email, Source: "configured"}
}
