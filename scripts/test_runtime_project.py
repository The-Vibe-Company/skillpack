"""Project inventories enroll reviewed bytes, without trusting extra local files."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / '.agents/skillpack/usage'
sys.path.insert(0, str(DIRECTORY))
spec = importlib.util.spec_from_file_location('runtime_project_setup', DIRECTORY / 'setup.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class ProjectInventoryTests(unittest.TestCase):
    def test_committed_skills_and_portable_helpers_match(self):
        config = json.loads((DIRECTORY / 'inventory.json').read_text())
        inventory = setup.verified_project_inventory(ROOT, config)
        expected = {str(path.parent.resolve()) for path in (ROOT / '.agents/skills').glob('*/companion.json')
                    if json.loads(path.read_text()).get('metadata', {}).get('companionSkillId')}
        self.assertTrue(expected)
        self.assertEqual({row['path'] for row in inventory['skills']}, expected)
        for name in ('runtime_setup.py', 'runtime_lock.py', 'runtime_command.py', 'verify-runtime-release.mjs', 'skillpack-runtime-launch.py'):
            self.assertEqual((DIRECTORY / name).read_bytes(), (ROOT / 'packages/skillpack-skill/skill/scripts' / name).read_bytes())
        self.assertEqual((ROOT / '.opencode/plugins/skillpack-runtime.js').read_bytes(),
                         (ROOT / 'packages/skillpack-skill/skill/scripts/opencode-runtime.mjs').read_bytes())

    def test_modified_extra_and_escaped_files_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            skill = root / 'skill'
            skill.mkdir()
            markdown = skill / 'SKILL.md'
            markdown.write_text('Reviewed instructions')
            row = {'path': 'skill', 'skillId': 'c4f87fba-3194-42fb-9a61-738a718d9ac5', 'version': '1.0.0', 'origin': 'https://skillpack.app', 'files': {'SKILL.md': hashlib.sha256(markdown.read_bytes()).hexdigest()}}
            config = {'origins': ['https://skillpack.app'], 'skills': [row]}
            self.assertEqual(len(setup.verified_project_inventory(root, config)['skills']), 1)
            markdown.write_text('Locally customized')
            with self.assertRaises(ValueError):
                setup.verified_project_inventory(root, config)
            markdown.write_text('Reviewed instructions')
            (skill / 'extra.py').write_text('unreviewed')
            with self.assertRaises(ValueError):
                setup.verified_project_inventory(root, config)
            row['path'] = '../outside'
            with self.assertRaises(ValueError):
                setup.verified_project_inventory(root, config)


if __name__ == '__main__':
    unittest.main()
