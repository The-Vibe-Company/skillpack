#!/usr/bin/env python3
"""Explicit sandbox/image setup. No credentials, package execution or history scan."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from runtime_setup import install_runtime, runtime_home, atomic_json
from datetime import datetime, timezone

DIRECTORY = Path(__file__).resolve().parent
ROOT = DIRECTORY.parents[2]


def verified_project_inventory(root, config):
    skills = []
    for row in config['skills']:
        directory = (root / row['path']).resolve()
        if not directory.is_relative_to(root.resolve()) or row['origin'] not in config['origins']:
            raise ValueError('project inventory escaped approved roots/origins')
        actual_files = {str(path.relative_to(directory)).replace(os.sep, '/') for path in directory.rglob('*')
                        if path.is_file() and '__pycache__' not in path.parts and path.name != '.DS_Store'}
        if actual_files != set(row['files']):
            raise ValueError('project skill contains unreviewed or missing files')
        for relative, digest in row['files'].items():
            path = (directory / relative).resolve()
            if not path.is_relative_to(directory) or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise ValueError('project skill differs from reviewed inventory; refresh through a PR')
        skills.append({'path': str(directory), 'skill_id': row['skillId'], 'version': row['version'], 'origin': row['origin']})
    return {'schema_version': 1, 'origins': config['origins'], 'skills': skills}


def main():
    inventory = verified_project_inventory(ROOT, json.loads((DIRECTORY / 'inventory.json').read_text()))
    state = runtime_home()
    try:
        result = install_runtime(json.loads((DIRECTORY / 'runtime-release.json').read_text()), state)
    except Exception:
        print(json.dumps({'status': 'distribution_unavailable', 'reason': 'Verified release unavailable; rerun setup after publication. Existing runtime preserved.'}))
        return
    descriptor, filename = tempfile.mkstemp(prefix='.project-inventory-', dir=state)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            json.dump(inventory, output)
        subprocess.run([str(state / result['binary']), '--state-dir', str(state), 'register', '--inventory', filename], check=True, timeout=10, stdout=subprocess.DEVNULL)
    finally:
        os.unlink(filename)
    atomic_json(state / 'hook-setup.json', {'schemaVersion': 1, 'agents': {'codex': True, 'claude-code': True, 'opencode': True},
                'scope': 'project', 'updatedAt': datetime.now(timezone.utc).isoformat()})
    print(json.dumps({'status': result['status'], 'skills': len(inventory['skills']), 'hooks': 'repository configured; review Codex definitions in /hooks', 'coverage': 'awaiting_real_hook'}))


if __name__ == '__main__':
    main()
