#!/usr/bin/env python3
"""Run an already-installed runtime without adding it to PATH or installing anything."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from runtime_setup import active_binary_path, runtime_home  # noqa: E402


VISIBLE_COMMANDS = {'doctor', 'sync', 'telemetry', 'watch'}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Run the installed Skillpack runtime')
    parser.add_argument('--state-dir', help='runtime state directory; defaults to SKILLPACK_RUNTIME_HOME')
    parser.add_argument('runtime_args', nargs=argparse.REMAINDER, help='runtime command and arguments')
    args = parser.parse_args(argv)
    runtime_args = list(args.runtime_args)
    if runtime_args and runtime_args[0] == '--':
        runtime_args.pop(0)
    if not runtime_args or runtime_args[0] not in VISIBLE_COMMANDS:
        parser.error('choose doctor, sync, watch, or telemetry enable|disable')
    state = Path(args.state_dir).expanduser() if args.state_dir else runtime_home()
    active_path = state / 'active.json'
    try:
        active = json.loads(active_path.read_text(encoding='utf-8'))
        executable = active_binary_path(state, active, require_exists=True)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f'runtime unavailable: {exc}', file=sys.stderr)
        return 1
    completed = subprocess.run([str(executable), '--state-dir', str(state), *runtime_args])
    return completed.returncode


if __name__ == '__main__':
    raise SystemExit(main())
