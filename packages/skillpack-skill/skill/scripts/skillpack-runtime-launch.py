#!/usr/bin/env python3
"""Stable hook launcher; versioned executables can be replaced safely on Windows."""
import json
from pathlib import Path
import subprocess
import sys

state = Path(__file__).resolve().parent
try:
    active = json.loads((state / 'active.json').read_text(encoding='utf-8'))
    executable = (state / active['binary']).resolve()
    executable.relative_to(state / 'versions')
    # State lives in a private user directory; hash once at install and on explicit setup.
    # Reading the entire binary on every tool hook would add needless latency.
    command = [str(executable), '--state-dir', str(state), *sys.argv[1:]]
    result = subprocess.run(command, stdin=sys.stdin.buffer, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, timeout=2)
    if result.returncode:
        (state / 'launcher-error.txt').write_text('runtime hook failed\n', encoding='utf-8')
except (OSError, ValueError, KeyError, subprocess.TimeoutExpired):
    try:
        (state / 'launcher-error.txt').write_text('runtime hook unavailable\n', encoding='utf-8')
    except OSError:
        pass
# Advisory collection must never block an agent tool or write model context.
sys.exit(0)
