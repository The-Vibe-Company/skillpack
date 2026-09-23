package cli

import (
	"encoding/json"
	"errors"
	"golang.org/x/sys/windows"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

type activationJob struct {
	Executable string          `json:"executable"`
	Binary     string          `json:"binary"`
	Receipt    string          `json:"receipt"`
	Body       json.RawMessage `json:"body"`
	Hash       string          `json:"hash"`
	Parent     uint32          `json:"parent"`
}

func activateNative(executable, binary, receipt string, body []byte) (string, error) {
	data, err := os.ReadFile(binary)
	if err != nil {
		return "", err
	}
	job := activationJob{executable, binary, receipt, body, digestBytes(data), uint32(os.Getpid())}
	path := filepath.Join(filepath.Dir(receipt), "activation.json")
	b, _ := json.Marshal(job)
	if err = writePrivate(path, b); err != nil {
		return "", err
	}
	command := exec.Command(binary, "--internal-native-activate", path)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.DETACHED_PROCESS | windows.CREATE_NEW_PROCESS_GROUP}
	if err = command.Start(); err != nil {
		return "", err
	}
	_ = command.Process.Release()
	return "activation_pending", nil
}

// A separate verified image waits for the old foreground process to exit.
// Atomic replacement either leaves the old launcher intact or installs the new
// one. Other mapped workers can delay replacement, never create a missing path.
func activateWorker(path string) int {
	var job activationJob
	b, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(b, &job) != nil {
		return 1
	}
	root := filepath.Dir(path)
	if filepath.Base(path) != "activation.json" || job.Receipt != filepath.Join(root, "install.json") || !filepath.IsAbs(job.Executable) || noSymlinkPath(filepath.Join(root, "versions"), job.Binary) != nil {
		return 1
	}
	old := struct {
		Executable string `json:"executablePath"`
	}{}
	b, err = os.ReadFile(job.Receipt)
	if err != nil || json.Unmarshal(b, &old) != nil || old.Executable != job.Executable {
		return 1
	}
	data, err := os.ReadFile(job.Binary)
	if err != nil || digestBytes(data) != job.Hash {
		return 1
	}
	if process, err := windows.OpenProcess(windows.SYNCHRONIZE, false, job.Parent); err == nil {
		state, _ := windows.WaitForSingleObject(process, 30_000)
		windows.CloseHandle(process)
		if state != windows.WAIT_OBJECT_0 {
			return 1
		}
	} else if !errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
		return 1
	}
	staged, err := stageFile(job.Executable, data, false)
	if err != nil {
		return 1
	}
	defer os.Remove(staged.Stage)
	for attempt := 0; attempt < 100; attempt++ {
		err = replaceFile(staged.Stage, job.Executable)
		if err == nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err != nil {
		_ = writePrivate(filepath.Join(root, "activation-error.json"), []byte(`{"status":"locked","next":"Close other Skillpack processes and retry self update"}`))
		return 1
	}
	if err = writePrivate(job.Receipt, job.Body); err != nil {
		return 1
	}
	_ = os.Remove(path)
	_ = os.Remove(filepath.Join(root, "activation-error.json"))
	return 0
}

func recoverNativeActivation(string) error { return nil }
