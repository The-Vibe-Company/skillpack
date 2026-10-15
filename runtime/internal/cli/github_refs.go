package cli

import (
	"bytes"
	"context"
	"io"
	"os"
	"os/exec"
	"strings"
)

// Test seam for CLI-level fixtures; production always uses the fixed public Git
// endpoint, without the caller's Git configuration, credentials, or environment.
var githubListRefs = readGitHubRefs

type githubRefReader func(context.Context, string, []string) (map[string]string, error)

type githubRefOutput struct {
	buffer bytes.Buffer
	cancel context.CancelFunc
}

func (b *githubRefOutput) Write(p []byte) (int, error) {
	if b.buffer.Len()+len(p) > 1<<20 {
		if b.cancel != nil {
			b.cancel()
		}
		return 0, io.ErrShortBuffer
	}
	return b.buffer.Write(p)
}

func readGitHubRefs(ctx context.Context, repository string, refs []string) (map[string]string, error) {
	if !validGitHubRepository(repository) {
		return nil, fail(2, "invalid GitHub repository")
	}
	args := []string{"-c", "credential.helper=", "-c", "core.askPass=", "-c", "http.extraHeader=", "-c", "http.followRedirects=false", "ls-remote", "--", "https://github.com/" + repository + ".git"}
	args = append(args, refs...)
	boundedCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(boundedCtx, "git", args...)
	// A minimal environment also excludes GITHUB_TOKEN, Git config injection,
	// credential helpers, URL rewrites and inherited authorization headers.
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=" + os.DevNull, "GIT_TERMINAL_PROMPT=0"}
	if root := os.Getenv("SYSTEMROOT"); root != "" {
		cmd.Env = append(cmd.Env, "SYSTEMROOT="+root)
	}
	directory, err := os.MkdirTemp("", "skillpack-git-refs-")
	if err != nil {
		return nil, fail(8, "could not prepare GitHub ref lookup")
	}
	defer os.RemoveAll(directory)
	cmd.Dir = directory
	cmd.Env = append(cmd.Env, "GIT_CEILING_DIRECTORIES="+os.TempDir())
	output := githubRefOutput{cancel: cancel}
	cmd.Stdout = &output
	if err := cmd.Run(); err != nil {
		return nil, fail(8, "could not resolve public GitHub refs; git must be installed and github.com reachable")
	}
	result := map[string]string{}
	for _, line := range strings.Split(output.buffer.String(), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) != 2 || !validGitHubSHA(fields[0]) {
			return nil, fail(8, "GitHub returned invalid refs")
		}
		if prior, ok := result[fields[1]]; ok && prior != strings.ToLower(fields[0]) {
			return nil, fail(5, "GitHub returned conflicting refs")
		}
		result[fields[1]] = strings.ToLower(fields[0])
	}
	return result, nil
}

func (g *githubResolver) resolveRefs(ctx context.Context, repository string, refs []string) (map[string]string, error) {
	reader := g.listRefs
	if reader == nil {
		reader = githubListRefs
	}
	return reader(ctx, repository, refs)
}

func commitForGitHubRef(refs map[string]string, ref string) (string, error) {
	if validGitHubSHA(ref) {
		return strings.ToLower(ref), nil
	}
	var commit string
	for _, name := range []string{"refs/heads/" + ref, "refs/tags/" + ref, ref} {
		sha, ok := refs[name]
		if !ok {
			continue
		}
		if peeled, ok := refs[name+"^{}"]; ok {
			sha = peeled
		}
		if !validGitHubSHA(sha) {
			return "", fail(8, "GitHub returned an invalid ref identity")
		}
		if commit != "" && commit != sha {
			return "", fail(5, "GitHub ref is ambiguous; use a full commit SHA")
		}
		commit = strings.ToLower(sha)
	}
	if commit == "" {
		return "", &githubStatusError{status: 404, err: fail(4, "GitHub reference was not found")}
	}
	return commit, nil
}

func githubRefPatterns(ref string) []string {
	if ref == "HEAD" {
		return []string{"HEAD"}
	}
	return []string{ref, "refs/heads/" + ref, "refs/tags/" + ref, "refs/tags/" + ref + "^{}"}
}
