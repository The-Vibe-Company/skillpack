import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import runtime_skill_sync
from companion_lib import compute_dir_checksum
from runtime_skill_sync import sync_decision, sync_runtime_skill_patches


class RuntimeSkillSyncTests(unittest.TestCase):
    def test_technical_patch_can_update_clean_copy_but_not_pin_or_customization(self):
        current = {'version': '1.2.4', 'metadata': {'usage': {'schemaVersion': 1,
                    'migration': {'parentVersion': '1.2.3'}}}}
        self.assertEqual(sync_decision('1.2.3', None, True, False, current), 'update')
        self.assertEqual(sync_decision('1.2.3', '1.2.3', True, False, current), 'pinned')
        self.assertEqual(sync_decision('1.2.3', None, False, False, current), 'customized')
        self.assertEqual(sync_decision('1.2.3', None, True, True, current), 'repository_pr_required')
        self.assertEqual(sync_decision('1.1.0', None, True, False, current), 'different_parent')
        self.assertEqual(sync_decision('1.2.4', None, True, False, current), 'current')

    def test_filesystem_sync_recovers_after_swap_before_lock_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / 'companion'
            state = root / 'runtime'
            target = root / 'skills' / 'demo'
            target.mkdir(parents=True)
            (target / 'SKILL.md').write_text('old\n')
            old_checksum = compute_dir_checksum(target)
            lock_path = home / 'skills.lock.json'
            home.mkdir()
            lock = {
                'lockfileVersion': 2,
                'workspaces': {
                    'ws': {
                        'apiUrl': 'https://api',
                        'skills': {
                            'demo': {
                                'name': 'demo', 'slug': 'demo', 'skillId': 'id', 'version': '1.0.0',
                                'checksum': 'sha256:old-package',
                                'targets': [{'tool': 'claude-code', 'scope': 'user', 'path': str(target),
                                             'checksum': old_checksum, 'packageChecksum': 'sha256:old-package',
                                             'version': '1.0.0'}],
                            }
                        },
                    }
                },
            }
            lock_path.write_text(json.dumps(lock))
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w') as archive:
                archive.writestr('SKILL.md', 'new\n')
                archive.writestr('companion.json', json.dumps({'version': '1.1.0', 'metadata': {
                    'companionSkillId': 'id', 'usage': {'schemaVersion': 1, 'migration': {'parentVersion': '1.0.0'}}
                }}))
            package_bytes = stream.getvalue()
            new_package_checksum = 'sha256:new-package'
            with patch.dict(os.environ, {'COMPANION_HOME': str(home), 'SKILLPACK_RUNTIME_HOME': str(state)}, clear=False), \
                 patch.object(runtime_skill_sync, 'api_download_bytes', return_value=package_bytes), \
                 patch.object(runtime_skill_sync, 'compute_package_checksum', return_value=new_package_checksum), \
                 patch.object(runtime_skill_sync, 'tracked', return_value=False):
                real_upsert = runtime_skill_sync.upsert_skill_lock_record
                with patch.object(runtime_skill_sync, 'upsert_skill_lock_record', side_effect=RuntimeError('crash after swap')):
                    with self.assertRaisesRegex(RuntimeError, 'crash after swap'):
                        sync_runtime_skill_patches('https://api', 'token', 'ws', [{'slug': 'demo', 'current_version': '1.1.0', 'checksum': new_package_checksum}])
                self.assertEqual((target / 'SKILL.md').read_text(), 'new\n')

                # A second run has no package network available. Recovery must finish the lock write
                # from the durable marker left after the successful filesystem swap.
                with patch.object(runtime_skill_sync, 'api_download_bytes', side_effect=AssertionError('network should not be needed')):
                    with patch.object(runtime_skill_sync, 'upsert_skill_lock_record', side_effect=real_upsert):
                        result = sync_runtime_skill_patches('https://api', 'token', 'ws', [{'slug': 'demo', 'current_version': '1.1.0', 'checksum': new_package_checksum}])
            self.assertEqual(result, [])
            record = json.loads(lock_path.read_text())['workspaces']['ws']['skills']['demo']
            self.assertEqual(record['version'], '1.1.0')
            self.assertEqual(record['targets'][0]['version'], '1.1.0')
            self.assertFalse((state / 'runtime-sync.pending.json').exists())

    def test_recovery_marker_cannot_be_applied_to_another_workspace(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / 'runtime'
            target = root / 'skills' / 'demo'
            target.mkdir(parents=True)
            (target / 'SKILL.md').write_text('new\n')
            marker = {
                'schemaVersion': 1, 'workspaceId': 'workspace-a', 'apiUrl': 'https://api-a',
                'skill': {'name': 'demo'},
                'targets': [{'path': str(target), 'checksum': compute_dir_checksum(target)}],
            }
            state.mkdir()
            (state / runtime_skill_sync.PENDING_SYNC_NAME).write_text(json.dumps(marker))
            with patch.object(runtime_skill_sync, 'upsert_skill_lock_record') as upsert:
                with self.assertRaisesRegex(ValueError, 'another workspace'):
                    runtime_skill_sync._recover_pending_sync(state, 'workspace-b', 'https://api-b')
            upsert.assert_not_called()
            self.assertTrue((state / runtime_skill_sync.PENDING_SYNC_NAME).exists())


if __name__ == '__main__':
    unittest.main()
