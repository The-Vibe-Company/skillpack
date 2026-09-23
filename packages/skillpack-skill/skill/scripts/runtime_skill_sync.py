"""Apply published technical usage patches to existing, unmodified user installs."""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote

from companion_lib import (api_download_bytes, compute_dir_checksum, load_json, load_local_inventory,
                           lockfile_path, upsert_skill_lock_record, workspace_lock_entry)
from install_skill import extract_package, deploy_to_target, compute_package_checksum
from secrets_runtime import projection_lock
from runtime_setup import atomic_json, runtime_home


PENDING_SYNC_NAME = 'runtime-sync.pending.json'


def _pending_sync_path(state: Path) -> Path:
    return state / PENDING_SYNC_NAME


def _recover_pending_sync(state: Path, workspace_id: str | None, api_url: str) -> None:
    """Complete a lock write after a process died immediately after a folder swap."""
    marker = _pending_sync_path(state)
    if not marker.is_file() or marker.is_symlink():
        return
    try:
        payload = load_json(marker)
    except SystemExit:
        marker.unlink(missing_ok=True)
        return
    if not isinstance(payload, dict) or not isinstance(payload.get('skill'), dict) or not isinstance(payload.get('targets'), list):
        raise ValueError('runtime sync recovery marker is incomplete')
    marker_workspace = payload.get('workspaceId')
    marker_api = payload.get('apiUrl')
    if marker_workspace != workspace_id or not isinstance(marker_api, str) or marker_api.rstrip('/') != api_url.rstrip('/'):
        # A single state directory can be shared by multiple workspace
        # processes. Never apply a marker created for another identity.
        raise ValueError('runtime sync recovery marker belongs to another workspace')
    ready: list[dict] = []
    for target in payload['targets']:
        if not isinstance(target, dict) or not target.get('path') or not target.get('checksum'):
            continue
        path = Path(str(target['path'])).expanduser()
        if path.is_dir() and compute_dir_checksum(path) == target['checksum']:
            ready.append(target)
    if ready and len(ready) == len(payload['targets']):
        upsert_skill_lock_record(lockfile_path(), workspace_id, api_url, payload['skill'], ready, relative_to=None)
        marker.unlink(missing_ok=True)


def sync_decision(installed: str, pin: str | None, clean: bool, git_tracked: bool, manifest: dict) -> str:
    if pin:
        return 'pinned'
    if not clean:
        return 'customized'
    if git_tracked:
        return 'repository_pr_required'
    if installed == manifest.get('version'):
        return 'current'
    usage = manifest.get('metadata', {}).get('usage', {})
    if usage.get('schemaVersion') != 1 or usage.get('migration', {}).get('parentVersion') != installed:
        return 'different_parent'
    return 'update'


def tracked(path: Path) -> bool:
    try:
        return subprocess.run(['git', '-C', str(path), 'ls-files', '--error-unmatch', '--', 'SKILL.md'],
                              capture_output=True, timeout=3).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def sync_runtime_skill_patches(api_url: str, token: str, workspace_id: str | None, workspace_rows: list[dict]) -> list[dict]:
    state = runtime_home()
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with projection_lock(state):
        _recover_pending_sync(state, workspace_id, api_url)
    _, installed = load_local_inventory(workspace_id, api_url)
    available = {row['slug']: row for row in workspace_rows if isinstance(row, dict) and row.get('slug')}
    results = []
    with projection_lock(state):
        for row in installed:
            remote = available.get(row['name'])
            if not remote or not remote.get('current_version') or remote['current_version'] == row.get('version'):
                continue
            raw = load_json(lockfile_path()) or {}
            record = (workspace_lock_entry(raw, workspace_id, api_url) or {}).get('skills', {}).get(row['name'], {})
            if record.get('pinned'):
                results.append({'slug': row['name'], 'status': 'pinned'})
                continue
            candidates = []
            for target in row.get('targets', []):
                path = Path(target['path']).expanduser().resolve()
                if target.get('scope') != 'user' or tracked(path):
                    results.append({'slug': row['name'], 'status': 'repository_pr_required'})
                elif not target.get('checksum') or not path.is_dir() or compute_dir_checksum(path) != target['checksum']:
                    results.append({'slug': row['name'], 'status': 'customized'})
                else:
                    candidates.append((target, path))
            if not candidates:
                continue
            version = remote['current_version']
            data = api_download_bytes(api_url, token, f'/skills/{quote(row["name"], safe="")}/versions/{quote(version, safe="")}/package')
            with tempfile.TemporaryDirectory(prefix='skillpack-runtime-patch-') as temporary:
                package = extract_package(data, Path(temporary))
                manifest = json.loads((package / 'companion.json').read_text(encoding='utf-8'))
                checksum = compute_package_checksum(package)
                if not remote.get('checksum') or checksum != remote['checksum'] or manifest.get('version') != version:
                    raise ValueError('runtime skill patch integrity mismatch')
                if manifest.get('metadata', {}).get('companionSkillId') != row.get('skillId'):
                    raise ValueError('runtime skill patch identity mismatch')
                targets = []
                pending_targets = []
                pending_skill = {'name': row['name'], 'slug': row['name'], 'skillId': row.get('skillId'),
                                 'companionSkillId': row.get('companionSkillId'), 'version': version,
                                 'checksum': checksum, 'pinned': record.get('pinned')}
                for target, path in candidates:
                    decision = sync_decision(target.get('version') or row['version'], record.get('pinned'),
                                             compute_dir_checksum(path) == target['checksum'], tracked(path), manifest)
                    if decision == 'update':
                        pending_targets.append({**target, 'path': str(path), 'version': version,
                                                'checksum': compute_dir_checksum(package), 'packageChecksum': checksum})
                        atomic_json(_pending_sync_path(state), {'schemaVersion': 1,
                                                                'workspaceId': workspace_id,
                                                                'apiUrl': api_url.rstrip('/'),
                                                                'skill': pending_skill,
                                                                'targets': pending_targets})
                        deploy_to_target(package, path, path.parent)
                        targets.append(pending_targets[-1])
                    results.append({'slug': row['name'], 'status': 'updated' if decision == 'update' else decision})
                if targets:
                    upsert_skill_lock_record(lockfile_path(), workspace_id, api_url, pending_skill, targets, relative_to=None)
                    _pending_sync_path(state).unlink(missing_ok=True)
    return results
