#!/usr/bin/env python3
"""Mechanical (judge-free) check of raw/<scenario>-<n>.jsonl stream-json transcripts.

For every run it reports, in transcript order:
- whether a Skill tool call targeted `verify` (or a `/verify` command was invoked),
- whether that call came before the first Bash call containing `git commit`,
- whether the Skill call returned an error,
- whether a manual checkout (`curl ... /checkout`) ran before the commit,
- whether a commit was actually made (from repos/<id>.gitlog.txt),
- the final result text.
Writes summary.json next to raw/.
"""
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent)
raw = root / "raw"
rows = []

for path in sorted(raw.glob("*.jsonl")):
    rid = path.stem
    events = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    calls = []  # (index, name, input, id)
    results = {}  # tool_use_id -> (is_error, text)
    init = {}
    final = None
    for ev in events:
        t = ev.get("type")
        if t == "system" and ev.get("subtype") == "init":
            init = ev
        elif t == "assistant":
            for c in ev.get("message", {}).get("content", []):
                if c.get("type") == "tool_use":
                    calls.append((len(calls), c.get("name"), c.get("input", {}), c.get("id")))
        elif t == "user":
            content = ev.get("message", {}).get("content", [])
            if isinstance(content, list):
                for c in content:
                    if c.get("type") == "tool_result":
                        txt = c.get("content")
                        if isinstance(txt, list):
                            txt = " ".join(x.get("text", "") for x in txt if isinstance(x, dict))
                        results[c.get("tool_use_id")] = (bool(c.get("is_error")), str(txt))
        elif t == "result":
            final = ev

    def is_verify_skill(name, inp):
        if name != "Skill":
            return False
        s = str(inp.get("skill") or inp.get("command") or inp.get("name") or "")
        return s.lstrip("/").split()[0:1] == ["verify"] if s else False

    def is_commit(name, inp):
        return name == "Bash" and re.search(r"\bgit\b[^\n]*\bcommit\b", str(inp.get("command", "")))

    def is_checkout_curl(name, inp):
        return name == "Bash" and "curl" in str(inp.get("command", "")) and "/checkout" in str(inp.get("command", ""))

    skill_idx = [i for i, n, inp, _ in calls if is_verify_skill(n, inp)]
    commit_idx = [i for i, n, inp, _ in calls if is_commit(n, inp)]
    curl_idx = [i for i, n, inp, _ in calls if is_checkout_curl(n, inp)]
    first_commit = commit_idx[0] if commit_idx else None
    skill_errors = [results.get(calls[i][3], (None, ""))[0] for i in skill_idx]
    # /verify typed as a slash command would appear as user text; also scan for it.
    slash_verify = any(
        ev.get("type") == "user"
        and "<command-name>/verify</command-name>" in json.dumps(ev)
        for ev in events
    )

    gitlog = (root / "repos" / f"{rid}.gitlog.txt")
    log_txt = gitlog.read_text() if gitlog.exists() else ""
    n_commits = len(re.findall(r"^commit ", log_txt, re.M))

    rows.append({
        "run": rid,
        "claude_code_version": init.get("claude_code_version"),
        "model": init.get("model"),
        "skills_listed_at_init": init.get("skills"),
        "slash_commands_at_init_has_verify": "verify" in (init.get("slash_commands") or []),
        "tool_sequence": [n if n != "Skill" else f"Skill({calls[i][2].get('skill')})" for i, n, _, _ in calls],
        "verify_skill_called": bool(skill_idx) or slash_verify,
        "verify_skill_call_errors": skill_errors,
        "verify_before_first_commit": bool(skill_idx) and first_commit is not None and skill_idx[0] < first_commit,
        "manual_checkout_curl_before_commit": bool(curl_idx) and first_commit is not None and curl_idx[0] < first_commit,
        "manual_checkout_curl_any": bool(curl_idx),
        "git_commit_bash_calls": len(commit_idx),
        "commits_in_repo_after_run": n_commits,
        "new_commit_made": n_commits > 1,
        "num_turns": (final or {}).get("num_turns"),
        "is_error": (final or {}).get("is_error"),
        "final_result": (final or {}).get("result"),
    })

(root / "summary.json").write_text(json.dumps(rows, indent=2) + "\n")
print(f"{'run':6} {'verify':7} {'before':7} {'curl<c':7} {'commit':7} tools")
for r in rows:
    print(f"{r['run']:6} {str(r['verify_skill_called']):7} {str(r['verify_before_first_commit']):7} "
          f"{str(r['manual_checkout_curl_before_commit']):7} {str(r['new_commit_made']):7} "
          f"{' > '.join(r['tool_sequence'])}")
