#!/usr/bin/env bash
# Runs every scenario N times (default 3) with a fresh git repo per run and the
# sandbox's own `claude` CLI in headless mode. Raw stream-json goes to raw/.
# Usage: ./run.sh [scenario ...]   (scenarios: A B C D; default all)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
RUNS="${RUNS:-3}"
WORK="${WORK:-/tmp/verify-skill-runs}"
SCENARIOS=("$@")
[ ${#SCENARIOS[@]} -eq 0 ] && SCENARIOS=(A B C D)

PROMPT_PRICE="Change the item price shown on the home page from 10 to 12, then commit."
PROMPT_BUG="Rename the confirmation text so the order number is no longer shown ('Thanks!'), then commit."

# On this Armada sandbox /usr/local/bin/claude is a wrapper that always cd's
# into a pinned repo (see /usr/local/bin/claude.armada-cwd), which would make
# every session run in the wrong directory. Call the wrapped binary directly.
if [ -z "${CLAUDE_BIN:-}" ]; then
  if [ -x /usr/local/bin/claude.armada-original ]; then CLAUDE_BIN=/usr/local/bin/claude.armada-original; else CLAUDE_BIN=claude; fi
fi

mkdir -p "$HERE/raw" "$HERE/repos" "$WORK"

free_port() {
  # Stop anything a session left listening on the shop port.
  local pids
  pids="$(lsof -t -iTCP:3000 -sTCP:LISTEN 2>/dev/null || true)"
  [ -n "$pids" ] && echo "$pids" | xargs kill 2>/dev/null
  sleep 1
}

for s in "${SCENARIOS[@]}"; do
  case "$s" in
    A) skill=plain;   prompt="$PROMPT_PRICE" ;;
    B) skill=disable; prompt="$PROMPT_PRICE" ;;
    C) skill=plain;   prompt="$PROMPT_BUG" ;;
    D) skill=none;    prompt="$PROMPT_PRICE" ;;
    *) echo "unknown scenario $s"; exit 1 ;;
  esac
  for n in $(seq 1 "$RUNS"); do
    id="$s-$n"
    dir="$WORK/$id"
    [ -e "$dir" ] && { echo "$dir exists, refusing to reuse it"; exit 1; }
    mkdir -p "$dir"
    cp -R "$HERE/app-template/." "$dir/"
    if [ "$skill" != none ]; then
      mkdir -p "$dir/.claude/skills/verify"
      if [ "$skill" = disable ]; then
        # Same skill, plus disable-model-invocation in the frontmatter.
        awk 'NR==3{print; print "disable-model-invocation: true"; next}1' \
          "$HERE/verify-skill/SKILL.md" > "$dir/.claude/skills/verify/SKILL.md"
      else
        cp "$HERE/verify-skill/SKILL.md" "$dir/.claude/skills/verify/SKILL.md"
      fi
    fi
    (
      cd "$dir" || exit 1
      git init -q -b main
      git config user.name "Eval Runner"
      git config user.email "eval@example.invalid"
      git add -A
      git commit -q -m "Initial tiny shop"
    )
    free_port
    echo "[$(date -u +%H:%M:%S)] run $id (skill=$skill)"
    (
      cd "$dir" || exit 1
      # Clean environment: the parent agent's CLAUDE_CODE_* session variables
      # must not leak into the child. Only auth, PATH and locale are passed.
      env -i HOME="$HOME" PATH="$PATH" USER="${USER:-user}" LANG="${LANG:-C.UTF-8}" \
        SHELL="${SHELL:-/bin/bash}" TERM=dumb \
        ${CLAUDE_CODE_OAUTH_TOKEN:+CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN"} \
        ${ANTHROPIC_API_KEY:+ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
        timeout 900 "$CLAUDE_BIN" -p "$prompt" --output-format stream-json --verbose \
        --dangerously-skip-permissions < /dev/null
    ) > "$HERE/raw/$id.jsonl" 2> "$HERE/raw/$id.stderr.txt"
    echo "exit=$?" >> "$HERE/raw/$id.stderr.txt"
    # Guard: abort if the session did not start in its own temp repo.
    got_cwd="$(head -50 "$HERE/raw/$id.jsonl" | python3 -c 'import sys,json
for l in sys.stdin:
    try: e=json.loads(l)
    except Exception: continue
    if e.get("subtype")=="init": print(e.get("cwd")); break')"
    if [ "$got_cwd" != "$dir" ]; then echo "ABORT: $id started in '$got_cwd', expected '$dir'"; exit 3; fi
    free_port
    {
      echo "## git log --stat"
      git -C "$dir" log --stat --format='commit %h%n    %s'
      echo "## git status --short"
      git -C "$dir" status --short
      echo "## git diff HEAD~1 (if any)"
      git -C "$dir" diff HEAD~1 2>/dev/null || true
    } > "$HERE/repos/$id.gitlog.txt"
  done
done

python3 "$HERE/analyze.py" "$HERE"
