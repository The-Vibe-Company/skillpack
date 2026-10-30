---
title: "How to Check Agent Skills in CI: Validate, Lock, Sync"
description: "A CI setup for Claude Code and Codex skills: validate every SKILL.md, commit a lockfile, fail on drift with frozen sync, and review skill updates in PRs."
slug: how-to-check-agent-skills-in-ci
date: 2026-10-30
tags: ["Agent Skills", "CI", "Claude Code", "Codex", "Skillpack CLI"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# How to check agent skills in CI: validate, lock, sync

Skills are code now. A [`SKILL.md`](/blog/what-is-skill-md) folder tells Claude Code or Codex how to run your migrations, write your release notes or review your pull requests. If someone breaks the frontmatter, the skill stops loading. If someone tweaks the committed copy by hand, the agent acts differently on the next run and nobody notices.

CI can catch both. This guide sets up three checks: every skill in the repo is valid, every installed skill matches a lockfile, and skill updates arrive as reviewable pull requests. Every command and exit code below was run with Skillpack CLI 0.3.5 on October 30, 2026, in a fresh git repo with one public skill installed for Claude Code and Codex.

```takeaways
title: Key Takeaways
items:
  - lead: "Validate what you write"
    text: "skillpack skills validate exits 0 on a valid skill and 5 when the frontmatter is missing or the name or description is invalid."
  - lead: "Lock what you install"
    text: "A project install records each skill, its source commit and checksums in .companion/skills.lock.json. Commit it with the skill folders."
  - lead: "Fail on drift"
    text: "skillpack sync --frozen exits 9 when a committed copy was edited, and 4 when the lockfile is missing. It never rewrites the lockfile."
  - lead: "Watch for silent restores"
    text: "A deleted copy is restored and the command still exits 0. Check git status after the sync if CI should fail on that too."
  - lead: "Updates go through PRs"
    text: "Run skillpack update --all --dry-run on a schedule, then apply and commit updates in a pull request."
```

## What can go wrong with skills in a repo

Once a team commits skills to a repo, the same three failures keep coming back:

- **A broken skill.** Someone edits `SKILL.md` and deletes the YAML frontmatter, or renames the skill to something with spaces. The agent may simply stop picking it up. Nothing errors.
- **Drift between copies.** Claude Code reads `.claude/skills/`, Codex reads `.codex/skills/`, and a shared copy can live in `.agents/skills/`. Someone fixes a typo in one of them. Now two agents follow two different instructions.
- **Unreviewed updates.** A skill installed from GitHub gets refreshed on someone's laptop and the new version lands in a big commit. Nobody reads what the skill now tells the agent to do.

None of these break the build. That's exactly why you want a check.

## Step 1: validate every skill you write

If your repo contains skills you author, validate each folder before it merges.

```sh
skillpack skills validate ./skills/release-notes
```

On a valid skill it prints the name, the file count and a checksum, then exits 0:

```text
checksum: "sha256:38e3bae7..."
files: 1
name: "release-notes"
serverValidation: "performed during publication"
valid: true
```

We broke two folders on purpose. Here's what came back:

| What we broke | Message | Exit code |
| :- | :- | :- |
| `SKILL.md` with no frontmatter | `SKILL.md needs YAML frontmatter` | 5 |
| `name: Bad Name` and no description | `invalid skill name or description` | 5 |

Add `--json` when you want a machine-readable result. The broken folder returned `{"code":5,"error":"SKILL.md needs YAML frontmatter","ok":false}`.

Note the `serverValidation` line. The local check covers the folder and its frontmatter. More checks run when you publish the skill to a Skillpack workspace, so passing locally doesn't mean you're done.

To validate every skill folder in the repo, loop over each `SKILL.md`:

```sh
set -e
for f in $(git ls-files 'skills/**/SKILL.md'); do
  skillpack skills validate "$(dirname "$f")"
done
```

Point the pattern at wherever you keep source skills. Skip the copies that the CLI installs into `.claude/skills/` and `.codex/skills/`; those are covered by the next step. If you're writing your first one, [how to create a Claude Code skill](/blog/how-to-create-a-claude-code-skill) covers the frontmatter fields.

## Step 2: install skills with a lockfile and commit it

For skills you install rather than write, use a project install:

```sh
skillpack install github:anthropics/skills/skills/webapp-testing \
  --scope project --tools claude-code,codex --yes
```

In our test repo this wrote:

- `.agents/skills/webapp-testing/` (the shared copy)
- `.claude/skills/webapp-testing/` for Claude Code
- `.codex/skills/webapp-testing/` for Codex (more on paths in [how to use skills in Codex](/blog/how-to-use-skills-in-codex))
- `.companion/skills.lock.json`

The lockfile records the source repository, path and commit, a package checksum, and one entry per target folder with its own checksum. For a GitHub skill it also lists the executable files it found, here `scripts/with_server.py`.

`--yes` accepts the "not verified by Skillpack" warning for third-party GitHub skills without prompting. Read that warning once before you add the flag. It names the commit and the executable files, and it reminds you that the skill's instructions can make your agent run commands. Skillpack only copies files; it never runs package scripts.

Commit the skill folders and `.companion/skills.lock.json` together. Leave out the temporary `.skillpack-stage-*` and `.skillpack-backup-*` files. From here on, the lockfile is the record of what your agents are allowed to load. For the wider team setup, see [how to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team).

## Step 3: fail CI on drift with frozen sync

If you only add one check, make it this one:

```sh
skillpack sync --frozen
```

It compares every committed copy with the lockfile. Here's what we saw:

| Situation | Result | Exit code |
| :- | :- | :- |
| All copies match the lockfile | `status: "verified"`, `restored: 0` | 0 |
| One line added to `.claude/skills/.../SKILL.md` | `locked package drift; files and lockfile preserved` | 9 |
| `.codex/skills/webapp-testing/` deleted | restored from another verified copy, `restored: 1` | 0 |
| No lockfile in the repo | `project skills lockfile missing` | 4 |

Two things to notice.

First, drift fails loudly and touches nothing. The edited file and the lockfile stay as they were, so you can see the change in the CI logs and fix it in a commit. Frozen sync never rewrites the lockfile.

Second, a missing copy doesn't count as a failure. Sync puts it back from another verified copy and exits 0. That's handy on a laptop. In CI it can hide a commit that forgot a folder. If you want CI to fail on that too, check the working tree right after the sync:

```sh
skillpack sync --frozen
test -z "$(git status --porcelain)"
```

`git status --porcelain` lists both edited and newly created files, so a restored folder shows up even though it was never committed.

Or read the JSON output and fail when anything was restored:

```sh
skillpack sync --frozen --json | jq -e '.restored == 0 and .status == "verified"'
```

On our clean repo the JSON was `{"dryRun":false,"lockChanged":false,"restored":0,"runtimePrerequisites":"not_verified_offline","status":"verified","targets":3}`.

`runtimePrerequisites: "not_verified_offline"` means sync checked the files, not whether the tools a skill needs (Python, a browser, an API key) exist on the runner. If a skill depends on them, test that separately.

Sync runs offline when at least one verified copy is in the repo. If every copy of a skill is missing, it has to download the locked version, which needs credentials for your Skillpack organization. Pass `SKILLPACK_API_KEY` through your CI provider's secret store, never in the workflow file.

```cta
title: "Lock your team's skills in one place"
text: "Create a free Skillpack workspace to version your SKILL.md folders, install them into Claude Code and Codex with a lockfile, and check them in CI."
primary: { label: "Create a free Skillpack workspace", href: /login }
secondary: { label: "How to install skills in Claude Code", href: /blog/how-to-install-skills-in-claude-code }
```

## A GitHub Actions example

Here's a minimal workflow with the two checks. The first step installs the Skillpack CLI with the official installer.

```yaml
name: skills
on:
  pull_request:
    paths:
      - "skills/**"
      - ".agents/skills/**"
      - ".claude/skills/**"
      - ".codex/skills/**"
      - ".companion/skills.lock.json"

jobs:
  check-skills:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Skillpack CLI
        run: |
          cd "$RUNNER_TEMP"
          base=https://github.com/The-Vibe-Company/skillpack/releases/download/runtime-v0.3.5
          curl -fsSLO "$base/install.sh"
          curl -fsSLO "$base/SHA256SUMS"
          grep ' install.sh$' SHA256SUMS | sha256sum -c -
          sh install.sh
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"
      - name: Validate authored skills
        run: |
          set -e
          for f in $(git ls-files 'skills/**/SKILL.md'); do
            skillpack skills validate "$(dirname "$f")"
          done
      - name: Frozen sync
        env:
          SKILLPACK_API_KEY: ${{ secrets.SKILLPACK_API_KEY }}
        run: |
          skillpack sync --frozen
          test -z "$(git status --porcelain)"
```

The `paths` filter keeps the job off pull requests that don't touch skills. Exit codes do the rest: any non-zero code from validate or sync fails the step.

## Step 4: update skills through pull requests

Locked skills don't update themselves. To see what's behind, run a dry run:

```sh
skillpack update --all --dry-run
```

It lists each skill it would update and changes no files. A weekly scheduled job can run it and post the result, or a teammate can run it locally. Then apply the update, commit the skill folders and the lockfile in one pull request, and let the frozen sync job check it. The diff shows which instructions changed. That's the part worth reading: a new line in a skill is a new thing your agent will do. Pinned skills stay where they are unless you choose to move them.

## Which check do you need?

| You have | Run in CI |
| :- | :- |
| Skills you write in the repo | `skillpack skills validate` on each folder |
| Skills installed from a registry or GitHub | `skillpack sync --frozen` |
| Both, and CI must catch missing folders | Both, plus an empty `git status --porcelain` after sync |
| Skills that need tools at runtime | A separate test that runs the tool, since sync doesn't check it |

Start with frozen sync. It's one line, it runs offline, and it catches the failure that costs the most time to debug: an agent following a skill nobody agreed on. When you want those skills versioned across several repos, a free [Skillpack workspace](/login) keeps them in one place.

```faq
items:
  - question: "How do I validate a SKILL.md file in CI?"
    answer: "Run skillpack skills validate on the skill folder. It exits 0 when the skill is valid and 5 when the YAML frontmatter is missing or the name or description is invalid. Add --json for machine-readable output."
  - question: "What does skillpack sync --frozen check?"
    answer: "It compares every installed copy of each skill with the checksums in .companion/skills.lock.json. If a copy was edited it fails with exit code 9 and leaves the files and lockfile untouched. It never rewrites the lockfile."
  - question: "Does frozen sync fail when a skill folder is missing?"
    answer: "No. In our test with CLI 0.3.5 it restored the missing copy from another verified copy and exited 0. Check that git status --porcelain is empty after the sync, or check that restored is 0 in the JSON output, if CI should fail in that case."
  - question: "Does frozen sync need network access or an API key?"
    answer: "Not when at least one verified copy of each skill is committed; it runs offline. If every copy of a skill is missing, it downloads the locked version, which needs credentials for your Skillpack organization, passed as SKILLPACK_API_KEY from your CI secrets."
  - question: "Which files should I commit?"
    answer: "The installed skill folders (.agents/skills, .claude/skills, .codex/skills, depending on your tools) and .companion/skills.lock.json. Don't commit the temporary .skillpack-stage-* or .skillpack-backup-* files."
  - question: "How do I update locked skills safely?"
    answer: "Run skillpack update --all --dry-run to see what would change, apply the update, and commit the skill folders and lockfile in a pull request so the frozen sync job and a reviewer both check it."
  - question: "Does this work for Codex as well as Claude Code?"
    answer: "Yes. Install with --tools claude-code,codex and the CLI writes a copy for each tool and tracks all of them in the same lockfile, so frozen sync checks every copy."
```
