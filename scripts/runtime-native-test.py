#!/usr/bin/env python3
"""Exercise the actual native executable, offline, with an isolated state directory."""
import json
from contextlib import closing
import hashlib
import shutil
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import tarfile
import zipfile
import platform
import time


def native_installer_smoke(binary, cli_binary):
    """Execute the actual host installer with deterministic release bytes, not network mocks of filesystem operations."""
    repository = Path(__file__).resolve().parents[1]
    version = (repository / 'runtime/VERSION').read_text().strip()
    with tempfile.TemporaryDirectory(prefix='skillpack-installer-') as temporary:
        root = Path(temporary).resolve()
        windows = sys.platform == 'win32'
        machine = platform.machine().lower()
        arch = 'arm64' if machine in ('arm64', 'aarch64') else 'amd64'
        target = ('windows' if windows else ('darwin' if sys.platform == 'darwin' else 'linux')) + '_' + arch
        archive = root / ('skillpack-runtime_' + version + '_' + target + ('.zip' if windows else '.tar.gz'))
        binaries = {'skillpack-runtime' + ('.exe' if windows else ''): binary,
                    'skillpack' + ('.exe' if windows else ''): cli_binary}
        if windows:
            with zipfile.ZipFile(archive, 'w') as package:
                for name, source in binaries.items(): package.write(source, name)
        else:
            with tarfile.open(archive, 'w:gz') as package:
                for name, source in binaries.items(): package.add(source, arcname=name)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        (root / 'SHA256SUMS').write_text(digest + '  ' + archive.name + '\n')
        installer = root / ('install.ps1' if windows else 'install.sh')
        text = (repository / 'runtime' / installer.name).read_text().replace('__SKILLPACK_RELEASE_VERSION__', version)
        if windows:
            text = text.replace('# __SKILLPACK_PINNED_HASH_SWITCH__', '"' + target + '" { return "' + digest + '" }')
            # The production installer uses a bounded .NET HTTPS transport.  Keep this
            # offline smoke deterministic by replacing only Download-Release in the
            # copied installer; all archive, checksum, ownership, and filesystem
            # operations still run through the real installer code.
            download_start = text.index('function Download-Release')
            download_end = text.index('\nfunction Assert-NoReparseAncestors', download_start)
            text = text[:download_start] + """function Download-Release([string]$Url, [string]$Destination) {
  $name = ([Uri]$Url).Segments[-1]
  Copy-Item -LiteralPath (Join-Path $env:SKILLPACK_INSTALL_FIXTURE $name) -Destination $Destination
}
""" + text[download_end:]
        else:
            text = text.replace('# __SKILLPACK_PINNED_HASH_CASES__', target + ') echo ' + digest + ' ;;')
        installer.write_text(text)
        home = root / 'home'; home.mkdir()
        environment = {**os.environ, 'HOME': str(home), 'USERPROFILE': str(home),
            'APPDATA': str(home / 'appdata'), 'LOCALAPPDATA': str(home / 'localappdata'),
            'SKILLPACK_HOME': str(home / 'client'), 'SKILLPACK_INSTALL_FIXTURE': str(root)}
        if windows:
            harness = root / 'run.ps1'
            harness.write_text("""$ErrorActionPreference = 'Stop'
& (Join-Path $env:SKILLPACK_INSTALL_FIXTURE 'install.ps1')
""")
            shell = shutil.which('pwsh') or shutil.which('powershell')
            assert shell, 'native Windows installer smoke requires PowerShell'
            command = [shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(harness)]
            launcher = home / 'localappdata/Skillpack/bin/skillpack.exe'
        else:
            harness = root / 'run.sh'
            harness.write_text("""set -eu
export SKILLPACK_INSTALL_SOURCE_ONLY=1
. "$SKILLPACK_INSTALL_FIXTURE/install.sh"
download() { cp "$SKILLPACK_INSTALL_FIXTURE/${1##*/}" "$2"; }
install
""")
            command = ['/bin/sh', str(harness)]
            launcher = home / '.local/bin/skillpack'
        # Fresh install and a second managed install must both work.
        for _ in range(2):
            result = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=60)
            assert result.returncode == 0, result.stderr
            receipt = json.loads((home / 'client/cli/install.json').read_text(encoding='utf-8-sig'))
            assert Path(receipt['executablePath']) == launcher
            assert receipt['version'] == version
            output = subprocess.run([str(launcher), '--version'], capture_output=True, text=True, check=True)
            assert output.stdout.strip() == 'skillpack ' + version
        if windows:
            # Exercise deferred activation while an old usage worker maps the stable image.
            # Sharing violations must leave that image usable; retry after exit must succeed.
            next_directory = home / 'client/cli/versions/activation-test'
            next_directory.mkdir()
            next_binary = next_directory / 'skillpack.exe'
            shutil.copy2(cli_binary, next_binary)
            next_receipt = {**receipt, 'binaryPath': str(next_binary),
                            'binarySha256': hashlib.sha256(next_binary.read_bytes()).hexdigest()}
            job = home / 'client/cli/activation.json'
            def write_activation(parent):
                job.write_text(json.dumps({'executable': str(launcher), 'binary': str(next_binary),
                    'receipt': str(home / 'client/cli/install.json'), 'body': next_receipt,
                    'hash': next_receipt['binarySha256'], 'parent': parent}))

            def start_worker():
                process = subprocess.Popen([str(launcher), 'usage', '--state-dir', str(home / ('worker-state-' + str(time.time_ns()))), 'worker'],
                    env={**environment, 'SKILLPACK_RUNTIME_NO_WAKE': '1'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                time.sleep(1)
                assert process.poll() is None, 'usage worker exited before activation test'
                return process

            # First prove that the helper waits for its actual foreground parent.
            worker = start_worker()
            write_activation(worker.pid)
            helper = subprocess.Popen([str(next_binary), '--internal-native-activate', str(job)],
                env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                time.sleep(1)
                assert helper.poll() is None, 'activation did not wait for its live parent'
                assert job.exists()
                assert json.loads((home / 'client/cli/install.json').read_text(encoding='utf-8-sig')) == receipt
                worker.terminate()
                worker.wait(timeout=10)
                assert helper.wait(timeout=25) == 0, 'activation failed after parent exit'
            finally:
                for process in (worker, helper):
                    if process.poll() is None: process.terminate()
                    process.wait(timeout=10)
            assert not job.exists()

            # An additional process may hold a no-delete-share file handle after the
            # foreground parent exits. Force that Windows sharing condition explicitly
            # instead of relying on a particular runner's executable image mapping.
            import ctypes
            from ctypes import wintypes
            kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
            kernel.CreateFileW.restype = wintypes.HANDLE
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel.CloseHandle.restype = wintypes.BOOL
            handle = kernel.CreateFileW(str(launcher), 0x80000000, 0x00000003, None, 3, 0x80, None)
            assert handle != ctypes.c_void_p(-1).value, 'cannot hold launcher sharing lock'
            before_activation = (home / 'client/cli/install.json').read_bytes()
            worker = start_worker()
            write_activation(0)  # the foreground parent is already gone
            try:
                attempt = subprocess.run([str(next_binary), '--internal-native-activate', str(job)],
                    env=environment, capture_output=True, text=True, timeout=25)
                assert attempt.returncode == 1, 'activation ignored a launcher sharing lock'
                assert worker.poll() is None, 'usage worker did not remain running'
                assert job.exists() and (home / 'client/cli/activation-error.json').exists()
                assert (home / 'client/cli/install.json').read_bytes() == before_activation
                subprocess.run([str(launcher), '--version'], check=True, capture_output=True)
            finally:
                kernel.CloseHandle(handle)
                if worker.poll() is None: worker.terminate()
                worker.wait(timeout=10)
            retried = subprocess.run([str(next_binary), '--internal-native-activate', str(job)],
                env=environment, capture_output=True, text=True, timeout=25)
            assert retried.returncode == 0, 'Windows activation did not recover after locks were released'
            assert not job.exists() and not (home / 'client/cli/activation-error.json').exists()
            activated = json.loads((home / 'client/cli/install.json').read_text(encoding='utf-8-sig'))
            assert Path(activated['binaryPath']) == next_binary

        # A launcher replaced by the user cannot be overwritten or legitimized by a new receipt.
        before = (home / 'client/cli/install.json').read_bytes()
        launcher.unlink(); launcher.write_text('user-owned launcher')
        result = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=60)
        assert result.returncode != 0, 'unmanaged launcher was overwritten'
        assert launcher.read_text() == 'user-owned launcher'
        assert (home / 'client/cli/install.json').read_bytes() == before


def main():
    binary = str(Path(sys.argv[1]).resolve())
    cli_binary = str(Path(sys.argv[2]).resolve()) if len(sys.argv) > 2 else None
    if cli_binary:
        version = subprocess.run([cli_binary, '--version'], capture_output=True, text=True, check=True, timeout=10)
        assert version.stdout.strip().startswith('skillpack '), version.stdout
        subprocess.run([cli_binary, '--help'], capture_output=True, text=True, check=True, timeout=10)
        native_installer_smoke(binary, cli_binary)
    with tempfile.TemporaryDirectory(prefix='runtime native é-') as temporary:
        root = Path(temporary)
        state = root / 'state'
        skill = root / 'skills/example'
        skill.mkdir(parents=True)
        (skill / 'SKILL.md').write_text('# Private instructions that never leave the device')
        inventory = {'schema_version': 1, 'origins': ['https://verified.example'], 'skills': [{
            'path': str(skill), 'skill_id': '11111111-1111-4111-8111-111111111111',
            'version': '1.2.3', 'origin': 'https://verified.example'}]}
        path = root / 'inventory.json'
        path.write_text(json.dumps(inventory))
        environment = {**os.environ, 'SKILLPACK_RUNTIME_NO_WAKE': '1', 'SKILLPACK_TELEMETRY': '1',
                       'SKILLPACK_TELEMETRY_USER_ID': '', 'SKILLPACK_TELEMETRY_EMAIL': ''}

        def invoke(*arguments, payload=None, env=None):
            completed = subprocess.run([binary, '--state-dir', str(state), *arguments],
                input=None if payload is None else json.dumps(payload), text=True, capture_output=True,
                check=True, timeout=10, env=env or environment)
            return json.loads(completed.stdout)

        if cli_binary:
            native_home = root / 'native-home'
            native_home.mkdir()
            native_environment = {**environment, 'PATH': str(root / 'no-interpreters'),
                'HOME': str(native_home), 'USERPROFILE': str(native_home),
                'SKILLPACK_HOME': str(native_home / 'client'),
                'SKILLPACK_LEGACY_HOME': str(native_home / 'legacy'),
                'SKILLPACK_RUNTIME_HOME': str(native_home / 'runtime'),
                'CODEX_HOME': str(native_home / 'codex'),
                'CLAUDE_CONFIG_DIR': str(native_home / 'claude'),
                'OPENCODE_CONFIG_DIR': str(native_home / 'opencode'),
                'SKILLPACK_API_KEY': '', 'SKILLPACK_API_URL': ''}
            for name in ('codex', 'claude', 'opencode'):
                (native_home / name).mkdir()
            def native(*arguments):
                result = subprocess.run([cli_binary, *arguments, *([] if arguments[0] == 'usage' else ['--json'])], env=native_environment,
                    capture_output=True, text=True, timeout=20)
                assert result.returncode == 0, result.stderr
                return json.loads(result.stdout)
            configured = native('setup', '--tools', 'codex,claude-code,opencode', '--project', str(root))
            assert configured['hooks']['codex'] == 'requires_host_approval', configured
            assert (native_home / 'opencode/plugins/skillpack-runtime.js').is_file()
            diagnostic = native('doctor', '--project', str(root))
            assert diagnostic['credentials'] == 'not_configured', diagnostic
            assert diagnostic['usage']['hooks']['codex']['configured'], diagnostic
            native('usage', 'telemetry', 'disable')
            assert native('doctor', '--project', str(root))['usage']['telemetry']['enabled'] is False
            # Hook command text contains native executable references only.
            assert 'python' not in (native_home / 'codex/hooks.json').read_text().lower()

        invoke('register', '--inventory', str(path))
        event = {'hook_event_name': 'PostToolUse', 'session_id': 'private-session', 'cwd': str(root),
                 'tool_name': 'Skill', 'tool_use_id': 'call-1', 'tool_input': {'skill': 'example'},
                 'tool_response': {'success': True}, 'prompt': 'private prompt must never appear on the wire'}
        assert invoke('hook', '--agent', 'claude-code', payload=event)['captured'] is True
        invoke('hook', '--agent', 'claude-code', payload=event)
        assert invoke('doctor', '--json')['queue']['pending'] == 1
        with closing(sqlite3.connect(state / 'runtime.sqlite3')) as db:
            payload = json.loads(db.execute('SELECT payload FROM events').fetchone()[0])
        assert set(payload) == {'schema_version', 'event_id', 'skill_id', 'version', 'kind', 'adapter', 'observed_at', 'agent', 'environment'}
        assert payload['kind'] == 'invocation' and payload['version'] == '1.2.3'
        assert 'private' not in json.dumps(payload)
        # Persist session opt-out; a later process without the env must still skip it.
        event.update(session_id='opted-out', tool_use_id='call-2')
        invoke('hook', '--agent', 'claude-code', payload=event, env={**environment, 'SKILLPACK_TELEMETRY': '0'})
        assert invoke('hook', '--agent', 'claude-code', payload=event)['captured'] is False
        assert invoke('doctor', '--json')['queue']['pending'] == 1
        # Run the committed bridge exactly through the platform shell from a repo subdirectory.
        repo = Path(__file__).resolve().parents[1]
        installed = state / 'versions' / 'test' / Path(binary).name
        installed.parent.mkdir(parents=True)
        shutil.copy2(binary, installed)
        (state / 'active.json').write_text(json.dumps({'binary': str(installed.relative_to(state)),
            'binarySha256': hashlib.sha256(installed.read_bytes()).hexdigest()}))
        hooks = json.loads((repo / '.codex/hooks.json').read_text())
        handler = hooks['hooks']['SessionStart'][0]['hooks'][0]
        bridge_env = {**environment, 'SKILLPACK_RUNTIME_HOME': str(state)}
        command = ([os.environ.get('COMSPEC', 'cmd.exe'), '/D', '/S', '/C', handler['commandWindows']]
                   if os.name == 'nt' else ['/bin/sh', '-c', handler['command']])
        completed = subprocess.run(command, cwd=repo / 'runtime', env=bridge_env, input=json.dumps({
            'hook_event_name': 'SessionStart', 'session_id': 'bridge-session', 'cwd': str(repo / 'runtime')}),
            capture_output=True, text=True, timeout=10, check=True)
        assert not completed.stdout and not completed.stderr, f'bridge stdout={completed.stdout!r} stderr={completed.stderr!r}'
        assert invoke('doctor', '--json')['hooks']['codex']['last_seen']
        # Exercise the shipped OpenCode plugin against the native executable;
        # the host callback shape comes from the isolated OpenCode 1.18 probe.
        plugin_test = '''
import { pathToFileURL } from 'node:url';
const plugin = await import(pathToFileURL(process.argv[1]).href);
const hooks = await plugin.default.server();
await hooks['chat.message']({ sessionID: 'native-opencode' });
const input = { tool: 'skill', sessionID: 'native-opencode', callID: 'native-call' };
const output = { metadata: { name: 'example', dir: process.argv[2] }, output: 'private instructions' };
await hooks['tool.execute.after'](input, output);
await hooks['tool.execute.after'](input, output);
'''
        completed = subprocess.run(['node', '--input-type=module', '-e', plugin_test,
            str(repo / '.opencode/plugins/skillpack-runtime.js'), str(skill)],
            env=bridge_env, capture_output=True, text=True, timeout=15, check=True)
        assert not completed.stdout and not completed.stderr, f'bridge stdout={completed.stdout!r} stderr={completed.stderr!r}'
        with closing(sqlite3.connect(state / 'runtime.sqlite3')) as db:
            events = db.execute("SELECT payload FROM events WHERE agent='opencode'").fetchall()
        assert len(events) == 1
        assert json.loads(events[0][0])['adapter'] == 'opencode-plugin'
        assert 'private' not in str(events)
        invoke('telemetry', 'disable')
        assert invoke('doctor', '--json')['queue']['pending'] == 0
        print('Native executable: verified inventory, durable redacted capture, dedupe and persistent opt-out passed.')


if __name__ == '__main__':
    main()
