---
name: install-skillpack-cli
description: Install the native Skillpack CLI, verify its setup, and use frozen skill packages in CI.
---

# Install Skillpack CLI

Use the [native CLI documentation](https://github.com/The-Vibe-Company/skillpack/blob/main/docs/skillpack-cli.md) as the installation source of truth.

1. Select the latest official `runtime-v*` release from [Skillpack releases](https://github.com/The-Vibe-Company/skillpack/releases). Download its `install.sh` (POSIX) or `install.ps1` (Windows), then run it with the platform shell. Release installers contain the expected archive digests; the checked-in installer template deliberately refuses installation. Use the native release installer, never `npm install skillpack`.
2. Ensure `~/.local/bin` (POSIX) or `%LOCALAPPDATA%\Skillpack\bin` (Windows) is in PATH. Check the installed executable:

   ```sh
   skillpack --version
   skillpack doctor --json
   ```

3. For workspace operations, run `skillpack auth login`, keep it running while the human approves the browser request, then check `skillpack auth status --json`. For self-hosting, pass `--api-url <base>`. Use [Sign in / create a workspace](/login) if the user needs an account. Anonymous catalog and public GitHub installs can proceed without login.
4. Configure the requested tools, for example `skillpack setup --tools codex,claude-code,opencode`. A configured hook does not prove it has observed usage; inspect doctor output before reporting setup complete.

## CI

Commit the reviewed project skill folders and `.companion/skills.lock.json`. After installing a chosen official runtime release in the runner, verify the committed packages without changing the lock:

```sh
skillpack --version
skillpack sync --frozen --project . --json
```

Verified copies work offline. If every copy of an authenticated registry skill is missing, restoration needs credentials for the locked instance and organization. Inject `SKILLPACK_API_KEY` through the runner's secret environment, and `SKILLPACK_API_URL` for a non-default instance. Keep credentials out of argv, chat, logs, and committed files. Public catalog and GitHub restoration can be anonymous. Report a nonzero exit as failure; package availability and secret/database readiness are separate checks.
