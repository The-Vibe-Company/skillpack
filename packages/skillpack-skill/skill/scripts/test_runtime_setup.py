import json
import base64
import tempfile
import subprocess
import hashlib
import io
import os
import tarfile
import zipfile
import unittest
from unittest.mock import patch
from pathlib import Path

import companion_lib
from runtime_command import VISIBLE_COMMANDS
from runtime_setup import (atomic_json, install_launcher, install_runtime, merge_hooks, runtime_target,
                           install_opencode_plugin, windows_hook_command,
                           setup_runtime, verified_inventory, verify_manifest)


class RuntimeSetupTests(unittest.TestCase):
    def test_runtime_command_exposes_explicit_continuous_watch(self):
        self.assertIn('watch', VISIBLE_COMMANDS)

    def test_opencode_plugin_uses_js_loader_name_and_preserves_unrelated_plugins(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_dir = Path(tmp) / 'opencode'
            plugins = config_dir / 'plugins'
            plugins.mkdir(parents=True)
            unrelated = plugins / 'unrelated.js'
            unrelated.write_text('export default {}\n')
            source = Path(__file__).with_name('opencode-runtime.mjs')
            result = install_opencode_plugin(source, config_dir)
            self.assertEqual(result, 'configured')
            installed = plugins / 'skillpack-runtime.js'
            self.assertEqual(installed.read_bytes(), source.read_bytes())
            self.assertEqual(unrelated.read_text(), 'export default {}\n')

    def test_opencode_plugin_collision_is_preserved_and_not_reported_configured(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_dir = Path(tmp) / 'opencode'
            plugins = config_dir / 'plugins'
            plugins.mkdir(parents=True)
            destination = plugins / 'skillpack-runtime.js'
            destination.write_text('// user-owned plugin\n')
            source = Path(__file__).with_name('opencode-runtime.mjs')
            result = install_opencode_plugin(source, config_dir)
            self.assertEqual(result, 'collision')
            self.assertEqual(destination.read_text(), '// user-owned plugin\n')

    def test_opencode_plugin_updates_a_previous_managed_copy_but_preserves_customized_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_dir = root / 'opencode'
            plugins = config_dir / 'plugins'
            plugins.mkdir(parents=True)
            source_v1 = root / 'runtime-v1.mjs'
            source_v2 = root / 'runtime-v2.mjs'
            source_v1.write_text('export const version = 1;\n')
            source_v2.write_text('export const version = 2;\n')
            self.assertEqual(install_opencode_plugin(source_v1, config_dir), 'configured')
            receipt = config_dir / '.skillpack-runtime-install.json'
            self.assertTrue(receipt.is_file())
            self.assertEqual(install_opencode_plugin(source_v1, config_dir), 'configured')
            self.assertEqual(install_opencode_plugin(source_v2, config_dir), 'configured')
            self.assertEqual((plugins / 'skillpack-runtime.js').read_text(), source_v2.read_text())
            self.assertEqual(json.loads(receipt.read_text())['sha256'], hashlib.sha256(source_v2.read_bytes()).hexdigest())
            (plugins / 'skillpack-runtime.js').write_text('// customized after managed install\n')
            self.assertEqual(install_opencode_plugin(source_v1, config_dir), 'collision')
            self.assertEqual((plugins / 'skillpack-runtime.js').read_text(), '// customized after managed install\n')

    def test_opencode_plugin_recovers_exact_first_install_without_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_dir = root / 'opencode'
            plugins = config_dir / 'plugins'
            plugins.mkdir(parents=True)
            source = root / 'runtime.mjs'
            source.write_text('export const recovered = true;\n')
            destination = plugins / 'skillpack-runtime.js'
            destination.write_bytes(source.read_bytes())
            self.assertEqual(install_opencode_plugin(source, config_dir), 'configured')
            self.assertTrue((config_dir / '.skillpack-runtime-install.json').is_file())

    def test_setup_installs_opencode_plugin_in_explicit_config_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            skill_dir = root / 'skill'
            skill_dir.mkdir()
            (skill_dir / 'runtime-release.json').write_text(json.dumps({'version': '0.1.0'}))
            state = root / 'runtime'
            opencode = root / 'opencode'
            (opencode / 'plugins').mkdir(parents=True)
            with patch.dict(os.environ, {
                'SKILLPACK_RUNTIME_HOME': str(state),
                'OPENCODE_CONFIG_DIR': str(opencode),
                'CODEX_HOME': str(root / 'missing-codex'),
                'CLAUDE_CONFIG_DIR': str(root / 'missing-claude'),
            }, clear=False), patch('runtime_setup.install_runtime', return_value={
                'version': '0.1.0', 'binary': 'versions/0.1.0/skillpack-runtime', 'status': 'installed',
            }):
                result = setup_runtime(skill_dir, 'http://127.0.0.1:8000', [], project_root=None)
            self.assertEqual(result['hooksConfigured'], ['opencode'])
            self.assertEqual(result['opencodeStatus'], 'configured')
            self.assertTrue((opencode / 'plugins' / 'skillpack-runtime.js').is_file())
            marker = json.loads((state / 'hook-setup.json').read_text())
            self.assertEqual(marker['agents'], {'opencode': True})

    def test_hook_installation_preserves_existing_hooks_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'hooks.json'
            existing = {'type': 'command', 'command': 'existing-command'}
            path.write_text(json.dumps({'unrelated': True, 'hooks': {'SessionStart': [{'hooks': [existing]}]}}))
            merge_hooks(path, 'python runtime-launch.py hook --agent codex', 'codex')
            once = path.read_bytes()
            merge_hooks(path, 'python runtime-launch.py hook --agent codex', 'codex')
            self.assertEqual(once, path.read_bytes())
            current = json.loads(once)
            self.assertTrue(current['unrelated'])
            self.assertEqual(current['hooks']['SessionStart'][0]['hooks'], [existing])
            self.assertIn('PostToolUse', current['hooks'])
            self.assertIn('UserPromptSubmit', current['hooks'])

    def test_supported_targets_are_explicit_and_unknown_machine_fails(self):
        self.assertEqual(runtime_target('Windows', 'AMD64'), 'windows_amd64')
        self.assertEqual(runtime_target('Darwin', 'arm64'), 'darwin_arm64')
        self.assertEqual(runtime_target('Linux', 'aarch64'), 'linux_arm64')
        with self.assertRaises(ValueError):
            runtime_target('Linux', 'riscv64')

    def test_codex_hook_has_windows_command_override_and_invalid_handlers_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'hooks.json'
            windows_command = windows_hook_command(['C:\\Program Files\\Python\\python.exe', 'C:\\Skill Pack\\runtime-launch.py', 'hook', '--agent', 'codex'])
            merge_hooks(path, 'python runtime-launch.py hook --agent codex', 'codex', command_windows=windows_command)
            hook = json.loads(path.read_text())['hooks']['PostToolUse'][-1]['hooks'][0]
            self.assertTrue(hook['commandWindows'].startswith('powershell.exe -NoProfile -NonInteractive -EncodedCommand '))
            encoded = hook['commandWindows'].rsplit(' ', 1)[-1]
            decoded = base64.b64decode(encoded).decode('utf-16le')
            self.assertTrue(decoded.startswith("$ProgressPreference = 'SilentlyContinue'\n"))
            self.assertIn("'C:\\Program Files\\Python\\python.exe'", decoded)
            self.assertIn("'C:\\Skill Pack\\runtime-launch.py'", decoded)
            self.assertIn('\nexit $LASTEXITCODE\n', decoded)
            path.write_text(json.dumps({'hooks': {'PostToolUse': [{'hooks': ['malformed']} ]}}))
            with self.assertRaisesRegex(ValueError, 'hook handler'):
                merge_hooks(path, 'python runtime-launch.py hook --agent codex', 'codex')

    def test_active_binary_containment_applies_to_current_and_newer_fast_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / 'state'
            state.mkdir()
            outside = Path(tmp) / 'outside-runtime'
            outside.write_bytes(b'outside')
            digest = hashlib.sha256(outside.read_bytes()).hexdigest()
            for version, requested in (('0.1.0', '0.1.0'), ('0.2.0', '0.1.0')):
                (state / 'active.json').write_text(json.dumps({
                    'version': version,
                    'binary': '../outside-runtime',
                    'binarySha256': digest,
                }))
                with self.assertRaisesRegex(ValueError, 'active runtime binary'):
                    install_runtime({'version': requested, 'baseUrl': 'https://example.test/runtime', 'publicKey': 'invalid'}, state,
                                    fetch=lambda _url, _limit: b'{}')

    def test_newer_active_hash_and_fresh_versions_directory_are_verified(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / 'state'
            binary = 'skillpack-runtime.exe' if runtime_target().startswith('windows_') else 'skillpack-runtime'
            active_binary = state / 'versions' / '0.2.0' / binary
            active_binary.parent.mkdir(parents=True)
            active_binary.write_bytes(b'known binary')
            (state / 'active.json').write_text(json.dumps({'version': '0.2.0',
                                                            'binary': str(active_binary.relative_to(state)),
                                                            'binarySha256': 'wrong'}))
            with self.assertRaisesRegex(ValueError, 'checksum'):
                install_runtime({'version': '0.1.0', 'baseUrl': 'https://example.test/runtime', 'publicKey': 'invalid'}, state,
                                fetch=lambda _url, _limit: b'{}')

            fresh = root / 'fresh'
            outside = root / 'outside'
            outside.mkdir()
            (fresh / 'versions').parent.mkdir(parents=True)
            (fresh / 'versions').symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'versions directory'):
                install_runtime({'version': '0.1.0', 'baseUrl': 'https://example.test/runtime', 'publicKey': 'invalid'}, fresh,
                                fetch=lambda _url, _limit: b'{}')

    def test_runtime_lockfile_write_is_atomic_and_launcher_install_is_race_safe(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / 'skills.lock.json'
            skill = {'name': 'demo', 'slug': 'demo', 'skillId': 'id', 'version': '1.0.0', 'checksum': 'sha256:p'}
            target = [{'tool': 'codex', 'scope': 'user', 'path': '/tmp/demo', 'checksum': 'sha256:d'}]
            with patch.object(companion_lib, '_atomic_json_write', wraps=companion_lib._atomic_json_write) as writer:
                companion_lib.upsert_skill_lock_record(path, 'ws', 'https://api', skill, target, None)
                self.assertTrue(writer.called)

            source = root / 'launcher.py'
            source.write_text('stable launcher\n')
            destination = root / 'state' / 'skillpack-runtime-launch.py'
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(lambda _index: install_launcher(source, destination), range(8)))
            self.assertEqual(destination.read_text(), 'stable launcher\n')
            self.assertFalse(any(item.name.endswith('.tmp') for item in destination.parent.iterdir()))

    def test_empty_or_unverified_inventory_still_installs_hooks_with_explicit_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            skill_dir = root / 'skill'
            skill_dir.mkdir()
            (skill_dir / 'runtime-release.json').write_text(json.dumps({'version': '0.1.0'}))
            state = root / 'runtime'
            codex = root / 'codex'
            codex.mkdir()
            with patch.dict(os.environ, {'SKILLPACK_RUNTIME_HOME': str(state), 'CODEX_HOME': str(codex), 'CLAUDE_CONFIG_DIR': str(root / 'claude'),
                                         'OPENCODE_CONFIG_DIR': str(root / 'missing-opencode')}, clear=False), \
                 patch('runtime_setup.install_runtime', return_value={'version': '0.1.0', 'binary': 'versions/0.1.0/skillpack-runtime', 'status': 'installed'}), \
                 patch('runtime_setup.install_launcher'):
                result = setup_runtime(skill_dir, 'http://127.0.0.1:8000', [], project_root=None)
            self.assertEqual(result['runtimeRegistration'], 'skipped_unverified_origin')
            self.assertEqual(result['hooksConfigured'], ['codex'])
            marker = json.loads((state / 'hook-setup.json').read_text())
            self.assertEqual(marker['schemaVersion'], 1)
            self.assertEqual(marker['agents'], {'codex': True})

    def test_verified_runtime_receipts_extend_inventory_and_new_setup_registers_immediately(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / 'runtime'
            skill = root / 'skill'
            skill.mkdir()
            (skill / 'SKILL.md').write_text('official\n')
            (skill / 'runtime-release.json').write_text(json.dumps({'version': '0.1.0'}))
            receipt_dir = state / 'installs'
            receipt_dir.mkdir(parents=True)
            checksum = companion_lib.compute_dir_checksum(skill)
            (receipt_dir / 'receipt.json').write_text(json.dumps({
                'schemaVersion': 1, 'origin': 'https://receipt.example', 'slug': 'demo',
                'skillId': '22222222-2222-4222-8222-222222222222', 'version': '1.0.0',
                'scope': 'user', 'path': str(skill), 'checksum': checksum,
            }))
            with patch.dict(os.environ, {'SKILLPACK_RUNTIME_HOME': str(state), 'CODEX_HOME': str(root / 'codex'),
                                         'CLAUDE_CONFIG_DIR': str(root / 'claude'),
                                         'OPENCODE_CONFIG_DIR': str(root / 'missing-opencode')}, clear=False):
                inventory = verified_inventory([], 'https://api.example')
                self.assertEqual(inventory['origins'], ['https://api.example', 'https://receipt.example'])
                self.assertEqual(inventory['skills'][0]['skill_id'], '22222222-2222-4222-8222-222222222222')

                binary = state / 'versions' / '0.1.0' / 'skillpack-runtime'
                binary.parent.mkdir(parents=True)
                binary.write_bytes(b'placeholder')
                with patch('runtime_setup.install_runtime', return_value={
                    'version': '0.1.0', 'binary': 'versions/0.1.0/skillpack-runtime', 'status': 'installed',
                }), patch('subprocess.run', return_value=subprocess.CompletedProcess([], 0)) as run:
                    result = setup_runtime(skill, 'https://api.example/v1', [], project_root=None)
            self.assertEqual(result['runtimeRegistration'], 'registered')
            self.assertEqual(result['registeredSkills'], 1)
            self.assertTrue(any('register' in call.args[0] for call in run.call_args_list))

    def test_distribution_failure_preserves_runtime_without_registering_new_inventory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / 'runtime'
            skill = root / 'skill'
            skill.mkdir()
            (skill / 'SKILL.md').write_text('official\n')
            (skill / 'runtime-release.json').write_text(json.dumps({'version': '0.2.0'}))
            binary = state / 'versions' / '0.1.0' / 'skillpack-runtime'
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b'previous verified runtime')
            (state / 'active.json').write_text(json.dumps({
                'version': '0.1.0',
                'binary': str(binary.relative_to(state)),
                'binarySha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
            }))
            active_before = (state / 'active.json').read_bytes()
            checksum = companion_lib.compute_dir_checksum(skill)
            rows = [{'skillId': '33333333-3333-4333-8333-333333333333', 'version': '1.0.0',
                     'targets': [{'path': str(skill), 'version': '1.0.0', 'checksum': checksum}]}]
            with patch.dict(os.environ, {
                'SKILLPACK_RUNTIME_HOME': str(state),
                'CODEX_HOME': str(root / 'missing-codex'),
                'CLAUDE_CONFIG_DIR': str(root / 'missing-claude'),
                'OPENCODE_CONFIG_DIR': str(root / 'missing-opencode'),
            }, clear=False), \
                 patch('runtime_setup.install_runtime', side_effect=ValueError('release unavailable')), \
                 patch('subprocess.run', return_value=subprocess.CompletedProcess([], 0)) as run:
                result = setup_runtime(skill, 'https://skillpack.app/v1', rows, project_root=None)
            self.assertEqual(result['status'], 'distribution_unavailable')
            self.assertTrue(result['installed'])
            self.assertNotIn('runtimeRegistration', result)
            self.assertEqual((state / 'active.json').read_bytes(), active_before)
            self.assertEqual(binary.read_bytes(), b'previous verified runtime')
            run.assert_not_called()

    def test_atomic_json_syncs_and_replaces_without_leaving_temp_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'state.json'
            atomic_json(path, {'value': 1})
            self.assertEqual(json.loads(path.read_text())['value'], 1)
            self.assertFalse(list(path.parent.glob('.runtime-*')))

    def test_new_install_calls_runtime_registration_and_exposes_summary_status(self):
        import install_skill
        with patch.object(install_skill, 'load_local_inventory', return_value=(None, [{'name': 'demo'}])), \
             patch.object(install_skill, 'setup_runtime', return_value={'status': 'installed', 'runtimeRegistration': 'registered'}) as setup:
            result = install_skill.setup_runtime_after_install('https://api.example', 'ws', None, installed_count=1)
        self.assertEqual(result['runtimeRegistration'], 'registered')
        setup.assert_called_once()

    def test_release_signature_rejects_changed_manifest_and_untrusted_keys(self):
        manifest = b'{"version":"0.1.0"}'
        signed = json.loads(subprocess.check_output(['node', '-e', "const c=require('node:crypto');const k=c.generateKeyPairSync('ed25519');const b=Buffer.from(process.argv[1]);process.stdout.write(JSON.stringify({key:k.publicKey.export({type:'spki',format:'pem'}),signature:c.sign(null,b,k.privateKey).toString('base64')}));", manifest.decode()]))
        verify_manifest(manifest, signed['signature'], signed['key'])
        with self.assertRaises(ValueError):
            verify_manifest(b'{"version":"9.0.0"}', signed['signature'], signed['key'])
        with self.assertRaises(ValueError):
            verify_manifest(manifest, signed['signature'], 'untrusted')

    def test_failed_update_keeps_previous_active_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            active = {'version': '0.0.1', 'binary': 'versions/0.0.1/skillpack-runtime'}
            (state / 'active.json').write_text(json.dumps(active))
            config = {'version': '0.1.0', 'baseUrl': 'https://example.test/runtime-v0.1.0', 'publicKey': 'invalid'}
            with self.assertRaises(ValueError):
                install_runtime(config, state, fetch=lambda url, limit: b'{}')
            self.assertEqual(json.loads((state / 'active.json').read_text()), active)

    @unittest.skipUnless(os.environ.get('SKILLPACK_RUNTIME_TEST_BINARY'), 'native runtime integration binary not supplied')
    def test_signed_native_binary_installs_and_corruption_cannot_replace_it(self):
        native = Path(os.environ['SKILLPACK_RUNTIME_TEST_BINARY']).resolve()
        binary = native.read_bytes()
        version = '0.1.0'
        base = 'https://example.test/runtime-v0.1.0'
        assets, responses = [], {}
        for target in ('darwin_amd64', 'darwin_arm64', 'linux_amd64', 'linux_arm64', 'windows_amd64', 'windows_arm64'):
            windows = target.startswith('windows_')
            name = f'skillpack-runtime_{version}_{target}' + ('.zip' if windows else '.tar.gz')
            filename = 'skillpack-runtime.exe' if windows else 'skillpack-runtime'
            stream = io.BytesIO()
            if windows:
                with zipfile.ZipFile(stream, 'w') as archive:
                    archive.writestr(filename, binary)
            else:
                with tarfile.open(fileobj=stream, mode='w:gz') as archive:
                    member = tarfile.TarInfo(filename)
                    member.size = len(binary)
                    member.mode = 0o755
                    archive.addfile(member, io.BytesIO(binary))
            data = stream.getvalue()
            responses[base + '/' + name] = data
            assets.append({'target': target, 'name': name, 'url': base + '/' + name,
                           'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        manifest = json.dumps({'schemaVersion': 1, 'version': version, 'protocolVersion': 1, 'assets': assets}).encode()
        signed = json.loads(subprocess.check_output(['node', '-e', "const c=require('node:crypto');const k=c.generateKeyPairSync('ed25519');process.stdout.write(JSON.stringify({key:k.publicKey.export({type:'spki',format:'pem'}),signature:c.sign(null,Buffer.from(process.argv[1]),k.privateKey).toString('base64')}));", manifest.decode()]))
        responses[base + '/manifest.json'] = manifest
        responses[base + '/manifest.sig'] = signed['signature'].encode()
        config = {'version': version, 'baseUrl': base, 'publicKey': signed['key']}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = install_runtime(config, root, fetch=lambda url, limit: responses[url])
            self.assertEqual(result['status'], 'installed')
            self.assertEqual(subprocess.check_output([str(root / result['binary']), '--version']).decode().strip(), 'skillpack-runtime 0.1.0')
            self.assertEqual(install_runtime(config, root, fetch=lambda url, limit: responses[url])['status'], 'current')
            selected = next(asset for asset in assets if asset['target'] == runtime_target())
            responses[selected['url']] = b'corrupted'
            with tempfile.TemporaryDirectory() as other:
                with self.assertRaisesRegex(ValueError, 'checksum'):
                    install_runtime(config, Path(other), fetch=lambda url, limit: responses[url])
                self.assertFalse((Path(other) / 'active.json').exists())


if __name__ == '__main__':
    unittest.main()
