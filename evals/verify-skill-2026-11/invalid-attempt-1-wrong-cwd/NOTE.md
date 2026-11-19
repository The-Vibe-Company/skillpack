# Invalid first attempt (kept for transparency, excluded from results)

The first launch of `run.sh` (19 November 2026) used `/usr/local/bin/claude`. On this sandbox that path is a wrapper that always `cd`s into a pinned repository (`/home/user/skillpack`, read from `/usr/local/bin/claude.armada-cwd`) before starting Claude Code. So all 8 sessions (A-1 to C-1, plus C-2, which was killed mid-run) started in the skillpack repo, not in their fresh temp repos. The `init` event of each log shows `"cwd": "/home/user/skillpack"`.

Consequences:

- A-1 to B-3 searched skillpack for an item price, found none, and changed nothing.
- C-1 found `evals/verify-skill-2026-11/app-template/server.js` (this harness's own template), edited it to show "Thanks!" and committed that to the local skillpack `main`. That local commit was never pushed. It was undone with `git reset --soft HEAD~1`, and the template was restored to its original content before the valid run.
- C-2 was killed by the operator after the problem was spotted. It made no edits.

The fix, now in `run.sh`: call the wrapped binary `/usr/local/bin/claude.armada-original` (same Claude Code 2.1.328), with a clean `env -i` environment, and abort if a session's `init.cwd` is not its temp repo. The skill was never active in these sessions, so none of these logs count toward the results. They were scrubbed the same way as `raw/`.
