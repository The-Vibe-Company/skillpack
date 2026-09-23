#!/usr/bin/env python3
"""Install the verified portable runtime and merge its agent hooks."""
from __future__ import annotations

import json
import hashlib
import os
import platform
import re
import stat
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit


def runtime_target(system: str | None = None, machine: str | None = None) -> str:
    operating_system = {'Darwin': 'darwin', 'Linux': 'linux', 'Windows': 'windows'}.get(system or platform.system())
    architecture = {'x86_64': 'amd64', 'amd64': 'amd64', 'arm64': 'arm64', 'aarch64': 'arm64'}.get((machine or platform.machine()).lower())
    if not operating_system or not architecture:
        raise ValueError('unsupported runtime platform')
    return f'{operating_system}_{architecture}'


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix='.runtime-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as out:
            json.dump(value, out, indent=2, sort_keys=True)
            out.write('\n')
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, path)
        try:
            directory = os.open(path.parent, os.O_RDONLY)
        except OSError:
            directory = None
        if directory is not None:
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def install_launcher(source: Path, destination: Path) -> None:
    """Install the stable launcher through a unique, same-directory atomic swap."""
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, name = tempfile.mkstemp(prefix='.launcher-', dir=destination.parent)
    try:
        with Path(source).open('rb') as source_stream, os.fdopen(descriptor, 'wb') as out:
            while chunk := source_stream.read(1024 * 1024):
                out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(name, 0o700)
        os.replace(name, destination)
        try:
            directory = os.open(destination.parent, os.O_RDONLY)
        except OSError:
            directory = None
        if directory is not None:
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def _install_file_if_absent(source: Path, destination: Path) -> bool:
    """Atomically publish a managed file without replacing a user collision."""
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, name = tempfile.mkstemp(prefix='.plugin-', dir=destination.parent)
    try:
        with Path(source).open('rb') as source_stream, os.fdopen(descriptor, 'wb') as out:
            while chunk := source_stream.read(1024 * 1024):
                out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(name, 0o700)
        try:
            # A hard link is the no-replace commit primitive available on all
            # supported desktop platforms. If another writer wins the race,
            # the existing file remains untouched.
            os.link(name, destination)
        except FileExistsError:
            return False
        directory = None
        try:
            directory = os.open(destination.parent, os.O_RDONLY)
        except OSError:
            pass
        if directory is not None:
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        return True
    finally:
        if os.path.exists(name):
            os.unlink(name)


def windows_hook_command(args: list[str]) -> str:
    """Build a cmd-safe PowerShell command with fixed UTF-16LE payload quoting."""
    import base64

    def quote(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    script = '& ' + ' '.join(quote(str(value)) for value in args) + '\nexit $LASTEXITCODE\n'
    encoded = base64.b64encode(script.encode('utf-16le')).decode('ascii')
    return f'powershell.exe -NoProfile -NonInteractive -EncodedCommand {encoded}'


def merge_hooks(path: Path, command: str, agent: str, command_windows: str | None = None) -> None:
    current = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    if not isinstance(current, dict) or not isinstance(current.get('hooks', {}), dict):
        raise ValueError('agent hooks must be a JSON object')
    events = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'SubagentStart', 'Stop']
    if agent == 'claude-code':
        events.extend(['UserPromptExpansion', 'PostToolUseFailure'])
    hooks = current.setdefault('hooks', {})
    for event in events:
        groups = hooks.setdefault(event, [])
        if not isinstance(groups, list):
            raise ValueError('agent hook event must be a list')
        retained = []
        for group in groups:
            if not isinstance(group, dict) or not isinstance(group.get('hooks'), list):
                raise ValueError('invalid hook matcher group')
            handlers = []
            for item in group['hooks']:
                if not isinstance(item, dict):
                    raise ValueError('invalid hook handler')
                if item.get('statusMessage') != 'Skillpack runtime':
                    handlers.append(item)
            if handlers:
                retained.append({**group, 'hooks': handlers})
        handler = {'type': 'command', 'command': command, 'timeout': 3, 'statusMessage': 'Skillpack runtime'}
        if agent == 'codex' and command_windows:
            # Codex supports a Windows command override; keep the POSIX command
            # for macOS/Linux and use an encoded PowerShell payload for cmd.exe.
            handler['commandWindows'] = command_windows
        retained.append({'hooks': [handler]})
        hooks[event] = retained
    atomic_json(path, current)


def _active_versions_dir(state_dir: Path) -> tuple[Path, Path]:
    state = Path(os.path.abspath(str(state_dir.expanduser())))
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    versions = state / 'versions'
    if os.path.lexists(versions):
        info = versions.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise ValueError('runtime versions directory is not a real directory')
    else:
        versions.mkdir(mode=0o700)
    os.chmod(versions, 0o700)
    return state, versions


def active_binary_path(state_dir: Path, active: dict, *, require_exists: bool = False) -> Path:
    """Resolve an active binary only when it remains physically inside ``state/versions``."""
    state, versions = _active_versions_dir(state_dir)
    raw = active.get('binary') if isinstance(active, dict) else None
    if not isinstance(raw, str) or not raw or Path(raw).is_absolute():
        raise ValueError('active runtime binary is outside the version directory')
    candidate = Path(os.path.abspath(str(state / raw)))
    try:
        candidate.relative_to(versions)
    except ValueError as exc:
        raise ValueError('active runtime binary is outside the version directory') from exc
    if candidate.is_symlink():
        raise ValueError('active runtime binary is a symlink')
    physical_versions = versions.resolve(strict=True)
    physical_candidate = candidate.resolve(strict=False)
    try:
        physical_candidate.relative_to(physical_versions)
    except ValueError as exc:
        raise ValueError('active runtime binary escapes the version directory') from exc
    if require_exists and (not candidate.is_file() or candidate.is_symlink()):
        raise ValueError('active runtime binary is missing')
    return candidate


def _version_tuple(value: str) -> tuple[int, int, int]:
    if not isinstance(value, str) or not re.fullmatch(r'\d+\.\d+\.\d+', value):
        raise ValueError('active runtime version is invalid')
    return tuple(int(part) for part in value.split('.'))


def verify_manifest(manifest: bytes, signature: str, public_key: str) -> None:
    """Use Node's platform crypto, already required by the Skillpack delegated auth client."""
    import base64
    import subprocess
    payload = json.dumps({'manifest': base64.b64encode(manifest).decode(),
                          'signature': signature, 'publicKey': public_key})
    try:
        result = subprocess.run(['node', str(Path(__file__).with_name('verify-runtime-release.mjs'))],
                                input=payload, text=True, capture_output=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError('runtime signature verifier unavailable') from exc
    if result.returncode:
        raise ValueError('invalid runtime release signature')


def runtime_home() -> Path:
    if os.environ.get('SKILLPACK_RUNTIME_HOME'):
        return Path(os.environ['SKILLPACK_RUNTIME_HOME']).expanduser().resolve()
    if os.name == 'nt':
        return Path(os.environ.get('APPDATA', str(Path.home() / 'AppData/Roaming'))) / 'skillpack'
    if platform.system() == 'Darwin':
        return Path.home() / 'Library/Application Support/skillpack'
    return Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'skillpack'


def opencode_config_dir() -> Path:
    configured = os.environ.get('OPENCODE_CONFIG_DIR', '').strip()
    if configured:
        return Path(configured).expanduser()
    return Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'opencode'


def install_opencode_plugin(source: Path, config_dir: Path) -> str:
    """Install the managed .js OpenCode plugin in an existing config tree.

    OpenCode 1.18 discovers JavaScript files in ``plugins``. The packaged
    source remains .mjs, while the installed filename is .js. A customized
    destination or a symlinked plugin tree is treated as a collision and is
    left byte-for-byte unchanged.
    """
    config_dir = Path(config_dir).expanduser()
    if not config_dir.is_dir():
        return 'absent'
    plugins = config_dir / 'plugins'
    if os.path.lexists(plugins):
        info = plugins.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            return 'collision'
    else:
        plugins.mkdir(mode=0o700)
    destination = plugins / 'skillpack-runtime.js'
    receipt_path = config_dir / '.skillpack-runtime-install.json'
    try:
        source_bytes = source.read_bytes()
    except OSError:
        return 'error'
    source_hash = hashlib.sha256(source_bytes).hexdigest()

    managed_hash = None
    if os.path.lexists(receipt_path):
        try:
            receipt_info = receipt_path.lstat()
            if stat.S_ISREG(receipt_info.st_mode) and not stat.S_ISLNK(receipt_info.st_mode):
                receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
                if (isinstance(receipt, dict) and receipt.get('schemaVersion') == 1
                        and receipt.get('destination') == 'plugins/skillpack-runtime.js'
                        and isinstance(receipt.get('sha256'), str)
                        and re.fullmatch(r'[a-f0-9]{64}', receipt['sha256'])):
                    managed_hash = receipt['sha256']
        except (OSError, json.JSONDecodeError):
            managed_hash = None

    def record_managed_copy() -> bool:
        try:
            atomic_json(receipt_path, {
                'schemaVersion': 1,
                'destination': 'plugins/skillpack-runtime.js',
                'sha256': source_hash,
            })
            return True
        except (OSError, ValueError):
            return False

    if os.path.lexists(destination):
        info = destination.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            return 'collision'
        try:
            current_bytes = destination.read_bytes()
            if current_bytes == source_bytes:
                # If setup was interrupted after publishing the plugin but
                # before its receipt, the exact packaged bytes are sufficient
                # to recover ownership on the next run.
                return 'configured' if record_managed_copy() else 'error'
        except OSError:
            return 'collision'
        if managed_hash is None:
            return 'collision'
        current_hash = hashlib.sha256(current_bytes).hexdigest()
        if current_hash != managed_hash:
            return 'collision'
        try:
            install_launcher(source, destination)
        except OSError:
            return 'error'
        return 'configured' if record_managed_copy() else 'error'
    try:
        installed = _install_file_if_absent(source, destination)
    except OSError:
        return 'error'
    if installed:
        return 'configured' if record_managed_copy() else 'error'
    try:
        info = destination.lstat()
        if stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode) and destination.read_bytes() == source_bytes:
            return 'configured' if record_managed_copy() else 'error'
    except OSError:
        pass
    return 'collision'


def download(url: str, limit: int) -> bytes:
    from urllib.parse import urlparse
    from urllib.request import urlopen
    parsed = urlparse(url)
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('127.0.0.1', 'localhost', '::1')):
        raise ValueError('runtime downloads require HTTPS')
    if parsed.username or parsed.password:
        raise ValueError('runtime download URL contains credentials')
    with urlopen(url, timeout=30) as response:
        final = urlparse(response.url)
        if final.scheme != 'https' and final.hostname not in ('127.0.0.1', 'localhost', '::1'):
            raise ValueError('unsafe runtime redirect')
        value = response.read(limit + 1)
        if len(value) > limit:
            raise ValueError('runtime download exceeds size limit')
        return value


def extract_runtime(data: bytes, destination: Path, binary: str, zipped: bool) -> None:
    import io
    import stat
    import tarfile
    import zipfile
    allowed = {binary, 'LICENSE', 'NOTICE', 'SOURCE.json'}
    seen = set()
    total = 0
    if zipped:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for item in archive.infolist():
                mode = item.external_attr >> 16
                if item.filename not in allowed or item.filename in seen or item.is_dir() or stat.S_ISLNK(mode):
                    raise ValueError('unsafe runtime archive entry')
                total += item.file_size
                if total > 256 * 1024 * 1024:
                    raise ValueError('runtime archive too large')
                seen.add(item.filename)
                (destination / item.filename).write_bytes(archive.read(item))
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            for item in archive:
                if item.name not in allowed or item.name in seen or not item.isfile():
                    raise ValueError('unsafe runtime archive entry')
                total += item.size
                if total > 256 * 1024 * 1024:
                    raise ValueError('runtime archive too large')
                seen.add(item.name)
                source = archive.extractfile(item)
                if source is None:
                    raise ValueError('missing runtime archive data')
                (destination / item.name).write_bytes(source.read())
    if binary not in seen:
        raise ValueError('runtime binary missing from archive')
    os.chmod(destination / binary, 0o700)


def install_runtime(config: dict, state_dir: Path, *, fetch=download) -> dict:
    import hashlib
    import shutil
    import subprocess
    from runtime_lock import runtime_lock
    version = config.get('version', '')
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('runtime version is invalid')
    target = runtime_target()
    binary = 'skillpack-runtime.exe' if target.startswith('windows_') else 'skillpack-runtime'
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(state_dir, 0o700)
    with runtime_lock(state_dir):
        active_path = state_dir / 'active.json'
        active = json.loads(active_path.read_text()) if active_path.exists() else {}
        # Validate the staging root before any fast path or download. A
        # pre-existing symlink here would otherwise redirect a fresh install.
        _, versions = _active_versions_dir(state_dir)
        if active.get('version') == version:
            path = active_binary_path(state_dir, active)
            if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == active.get('binarySha256'):
                return {**active, 'status': 'current'}
        if active.get('version') and _version_tuple(active['version']) > _version_tuple(version):
            path = active_binary_path(state_dir, active, require_exists=True)
            if hashlib.sha256(path.read_bytes()).hexdigest() != active.get('binarySha256'):
                raise ValueError('active runtime binary checksum mismatch')
            return {**active, 'status': 'newer_installed'}
        base = config['baseUrl'].rstrip('/')
        manifest_bytes = fetch(base + '/manifest.json', 65536)
        signature = fetch(base + '/manifest.sig', 1024).decode('ascii').strip()
        verify_manifest(manifest_bytes, signature, config['publicKey'])
        manifest = json.loads(manifest_bytes)
        if manifest.get('schemaVersion') != 1 or manifest.get('version') != version or manifest.get('protocolVersion') != 1:
            raise ValueError('runtime manifest version mismatch')
        targets = {f'{system}_{arch}' for system in ('darwin', 'linux', 'windows') for arch in ('amd64', 'arm64')}
        assets = manifest.get('assets', [])
        if len(assets) != 6 or {row.get('target') for row in assets} != targets:
            raise ValueError('runtime release is incomplete')
        asset = next(row for row in assets if row['target'] == target)
        extension = '.zip' if target.startswith('windows_') else '.tar.gz'
        expected_name = f'skillpack-runtime_{version}_{target}{extension}'
        if asset.get('name') != expected_name or asset.get('url') != base + '/' + expected_name:
            raise ValueError('unexpected runtime asset destination')
        if not isinstance(asset.get('size'), int) or not 0 < asset['size'] <= 128 * 1024 * 1024:
            raise ValueError('invalid runtime asset size')
        archive = fetch(asset['url'], asset['size'])
        if len(archive) != asset['size'] or hashlib.sha256(archive).hexdigest() != asset.get('sha256'):
            raise ValueError('runtime archive checksum mismatch')
        # Digest-addressed dirs also allow a repaired local copy without replacing a running .exe.
        destination = versions / f'{version}-{asset["sha256"][:16]}'
        if os.path.lexists(destination):
            if destination.is_symlink() or not destination.is_dir():
                raise ValueError('runtime version directory is not a real directory')
        staged = Path(tempfile.mkdtemp(prefix='.staged-', dir=versions))
        try:
            extract_runtime(archive, staged, binary, extension == '.zip')
            checked = subprocess.run([str(staged / binary), '--version'], capture_output=True, text=True, timeout=10)
            if checked.returncode or version not in checked.stdout.split():
                raise ValueError('runtime self-test failed')
            if destination.exists():
                previous = destination / binary
                if not previous.is_file() or previous.read_bytes() != (staged / binary).read_bytes():
                    raise ValueError('existing immutable runtime directory differs')
            else:
                os.replace(staged, destination)
            value = {'version': version, 'binary': str((destination / binary).relative_to(state_dir)),
                     'binarySha256': hashlib.sha256((destination / binary).read_bytes()).hexdigest()}
            atomic_json(active_path, value)
            return {**value, 'status': 'installed'}
        finally:
            if staged.exists():
                shutil.rmtree(staged)


def verified_inventory(rows: list[dict], origin: str, *, project_root: Path | None = None) -> dict:
    import uuid
    from urllib.parse import urlsplit
    from companion_lib import compute_dir_checksum

    def valid_origin(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        parsed = urlsplit(value.strip())
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            return None
        if parsed.path not in ('', '/'):
            return None
        return f'https://{parsed.netloc.lower()}'

    primary_origin = valid_origin(origin)
    origins = [primary_origin] if primary_origin else []
    skills = []
    seen_paths: set[str] = set()

    def add_skill(path: Path, identifier: object, version: object, skill_origin: object, checksum: object,
                  *, checksum_verified: bool = False) -> None:
        try:
            parsed_id = uuid.UUID(str(identifier))
        except (ValueError, TypeError, AttributeError):
            return
        verified_origin = valid_origin(skill_origin)
        if verified_origin is None or not isinstance(version, str) or not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?', version):
            return
        path = path.expanduser()
        if not path.is_absolute():
            if project_root is None:
                return
            path = project_root / path
        try:
            path = path.resolve(strict=True)
        except OSError:
            return
        if not path.is_dir() or not (path / 'SKILL.md').is_file() or not isinstance(checksum, str):
            return
        if (not checksum_verified and compute_dir_checksum(path) != checksum) or str(path) in seen_paths:
            return
        seen_paths.add(str(path))
        if verified_origin not in origins:
            origins.append(verified_origin)
        skills.append({'path': str(path), 'skill_id': str(parsed_id), 'version': version, 'origin': verified_origin})

    for row in rows:
        if not isinstance(row, dict):
            continue
        identifier = row.get('skillId') or row.get('companionSkillId')
        for target in row.get('targets', []) if isinstance(row.get('targets', []), list) else []:
            if not isinstance(target, dict):
                continue
            raw = target.get('path')
            if not raw:
                continue
            path = Path(raw).expanduser()
            if not path.is_absolute():
                if project_root is None:
                    continue
                path = project_root / path
            # A local edit is preserved, but is not described as verified official content.
            baseline = target.get('checksum')
            if baseline:
                if compute_dir_checksum(path) != baseline:
                    continue
            else:
                from install_skill import compute_package_checksum
                if not target.get('packageChecksum') or compute_package_checksum(path) != target['packageChecksum']:
                    continue
            version = target.get('version') or row.get('version')
            if not version:
                continue
            add_skill(path, identifier, version, origin, baseline, checksum_verified=True)

    # The TypeScript installer writes one checksum-verified receipt per direct
    # install. Receipts cover copies not represented in the Python lockfile,
    # including project or alternate-tool installs.
    receipts_dir = runtime_home() / 'installs'
    if receipts_dir.is_dir():
        for receipt_path in sorted(receipts_dir.glob('*.json')):
            try:
                if receipt_path.is_symlink() or not receipt_path.is_file():
                    continue
                receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(receipt, dict) or receipt.get('schemaVersion') != 1:
                continue
            add_skill(Path(str(receipt.get('path') or '')), receipt.get('skillId'), receipt.get('version'), receipt.get('origin'), receipt.get('checksum'))
    return {'schema_version': 1, 'origins': origins, 'skills': skills}


def setup_runtime(skill_dir: Path, api_url: str, rows: list[dict], *, project_root: Path | None = None) -> dict:
    import shlex
    import subprocess
    import sys
    from runtime_lock import runtime_lock
    config_path = skill_dir / 'runtime-release.json'
    if not config_path.is_file():
        return {'status': 'not_configured'}
    state = runtime_home()
    config = json.loads(config_path.read_text(encoding='utf-8'))
    try:
        result = install_runtime(config, state)
    except Exception:
        return {'status': 'distribution_unavailable', 'installed': (state / 'active.json').exists(),
                'reason': 'No verified runtime release available; existing runtime preserved.'}
    launcher = state / 'skillpack-runtime-launch.py'
    source = Path(__file__).with_name('skillpack-runtime-launch.py')
    parsed = urlsplit(api_url)
    origin = (
        f'https://{parsed.netloc}'
        if parsed.scheme == 'https' and parsed.hostname and parsed.netloc and not parsed.username and not parsed.password
        and not parsed.query and not parsed.fragment and parsed.path in ('', '/', '/v1', '/v1/')
        else ''
    )
    inventory = verified_inventory(rows, origin, project_root=project_root)
    registration = 'skipped_unverified_origin' if not origin else ('skipped_empty_inventory' if not inventory['skills'] else 'pending')
    configured = []
    with runtime_lock(state):
        if not launcher.exists() or launcher.read_bytes() != source.read_bytes():
            install_launcher(source, launcher)
        if origin and inventory['skills']:
            descriptor, filename = tempfile.mkstemp(prefix='.inventory-', suffix='.json', dir=state)
            try:
                with os.fdopen(descriptor, 'w', encoding='utf-8') as out:
                    json.dump(inventory, out)
                executable = active_binary_path(state, result, require_exists=True)
                registered = subprocess.run([str(executable), '--state-dir', str(state), 'register', '--inventory', filename],
                                            capture_output=True, text=True, timeout=10)
                registration = 'registered' if registered.returncode == 0 else 'failed'
            finally:
                if os.path.lexists(filename):
                    os.unlink(filename)
        locations = {'codex': Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'hooks.json',
                     'claude-code': Path(os.environ.get('CLAUDE_CONFIG_DIR', str(Path.home() / '.claude'))) / 'settings.json'}
        for agent, location in locations.items():
            if location.parent.is_dir():
                # Hooks run under the agent's shell; event input is never interpolated.
                command_args = [sys.executable, str(launcher), 'hook', '--agent', agent]
                command = shlex.join(command_args)
                command_windows = windows_hook_command(command_args) if agent == 'codex' else None
                merge_hooks(location, command, agent, command_windows=command_windows)
                configured.append(agent)
        opencode_status = 'absent'
        opencode_dir = opencode_config_dir()
        if opencode_dir.is_dir():
            try:
                opencode_status = install_opencode_plugin(Path(__file__).with_name('opencode-runtime.mjs'), opencode_dir)
            except (OSError, ValueError):
                opencode_status = 'error'
            if opencode_status == 'configured':
                configured.append('opencode')
        # The runtime owns the observation state, while setup only records the
        # fact that hook definitions were written.  This marker contains no
        # endpoint, identity, or credential and is replaced atomically so a
        # doctor call never mistakes a partial write for configured hooks.
        atomic_json(state / 'hook-setup.json', {
            'schemaVersion': 1,
            'agents': {agent: True for agent in configured},
            'updatedAt': _now_iso(),
        })
    status = result.get('status')
    if registration == 'failed':
        status = 'inventory_failed'
    return {**result, 'status': status, 'runtimeRegistration': registration, 'hooksConfigured': configured,
            'registeredSkills': len(inventory['skills']), 'coverage': 'awaiting_real_hook',
            'opencodeStatus': opencode_status,
            'codexTrust': 'Review new hook definitions in /hooks; setup does not alter trust.'}
