#!/usr/bin/env python3
"""Native runtime verification and immutable release archive production."""
import argparse
import hashlib
import gzip
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'packages/skillpack-skill/skill/scripts'))
from runtime_setup import runtime_target


def run(*args, cwd=ROOT, **kwargs):
    return subprocess.run(args, cwd=cwd, check=True, **kwargs)


def version_guard(version):
    base = os.environ.get('RUNTIME_BASE_SHA', '')
    if not base or set(base) == {'0'}:
        return
    previous = subprocess.run(['git', 'show', f'{base}:runtime/VERSION'], cwd=ROOT, capture_output=True, text=True)
    if previous.returncode:
        return  # First runtime publication.
    changed = run('git', 'diff', '--name-only', base, 'HEAD', '--', 'runtime', capture_output=True, text=True).stdout.splitlines()
    distributed = [name for name in changed if not name.endswith(('.md', '_test.go'))]
    if distributed and tuple(map(int, version.split('.'))) <= tuple(map(int, previous.stdout.strip().split('.'))):
        raise ValueError('Distributed runtime changed without a new runtime/VERSION')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    version = (ROOT / 'runtime/VERSION').read_text().strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('invalid runtime version')
    version_guard(version)
    config = json.loads((ROOT / 'packages/skillpack-skill/skill/runtime-release.json').read_text())
    if config['version'] != version:
        raise ValueError('installer/runtime version mismatch')
    target = runtime_target()
    actual = run('go', 'env', 'GOOS', 'GOARCH', cwd=ROOT / 'runtime', capture_output=True, text=True).stdout.split()
    if '_'.join(actual) != target:
        raise ValueError('Runtime Quality must execute natively, not cross-compile')
    env = {**os.environ, 'CGO_ENABLED': '0', 'GOTOOLCHAIN': 'local'}
    run('go', 'mod', 'verify', cwd=ROOT / 'runtime', env=env)
    run('go', 'test', './...', cwd=ROOT / 'runtime', env=env)
    run('go', 'vet', './...', cwd=ROOT / 'runtime', env=env)
    source_sha = run('git', 'rev-parse', 'HEAD', capture_output=True, text=True).stdout.strip()
    with tempfile.TemporaryDirectory(prefix='skillpack-build-') as temporary:
        directory = Path(temporary)
        extension = '.exe' if target.startswith('windows_') else ''
        binary = directory / f'skillpack-runtime{extension}'
        cli_binary = directory / f'skillpack{extension}'
        build_args = ('go', 'build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w')
        run(*build_args, '-o', str(binary), './cmd/skillpack-runtime', cwd=ROOT / 'runtime', env=env)
        run(*build_args, '-o', str(cli_binary), './cmd/skillpack', cwd=ROOT / 'runtime', env=env)
        value = run(str(binary), '--version', capture_output=True, text=True).stdout.strip()
        if value != f'skillpack-runtime {version}':
            raise ValueError('runtime binary version differs from VERSION')
        value = run(str(cli_binary), '--version', capture_output=True, text=True).stdout.strip()
        if value != f'skillpack {version}':
            raise ValueError('CLI binary version differs from VERSION')
        run(str(binary), '--state-dir', str(directory / 'state'), 'doctor', '--json')
        run(sys.executable, 'scripts/runtime-native-test.py', str(binary), str(cli_binary))
        run(sys.executable, 'scripts/test_runtime_project.py')
        test_env = {**env, 'SKILLPACK_RUNTIME_TEST_BINARY': str(binary)}
        run('node', '--test', 'packages/skillpack-skill/skill/scripts/test_opencode_runtime.mjs', env=test_env)
        run(sys.executable, '-m', 'unittest', 'discover', '-s', 'packages/skillpack-skill/skill/scripts', '-p', 'test_runtime*.py', env=test_env)
        if args.check_only:
            return
        shutil.copyfile(ROOT / 'LICENSE', directory / 'LICENSE')
        # Include third-party license texts in the distributed NOTICE.
        modules = run('go', 'list', '-m', '-f', '{{.Dir}}', 'all', cwd=ROOT / 'runtime', env=env, capture_output=True, text=True).stdout.splitlines()
        notices = ['Skillpack runtime: MIT. Third-party dependency notices follow.']
        for module in modules:
            if not module:
                continue
            for license_file in sorted(Path(module).glob('LICENSE*')):
                if license_file.is_file():
                    notices.append(license_file.parent.name + '\n' + license_file.read_text(errors='replace'))
        (directory / 'NOTICE').write_text('\n\n'.join(notices), encoding='utf-8')
        metadata = {'schemaVersion': 1, 'version': version, 'sourceSha': source_sha, 'target': target,
                    'binaries': [binary.name, cli_binary.name],
                    'testedOS': os.environ.get('RUNTIME_RUNNER', sys.platform), 'go': run('go', 'version', capture_output=True, text=True).stdout.strip()}
        (directory / 'SOURCE.json').write_text(json.dumps(metadata, sort_keys=True) + '\n')
        output = ROOT / '.context/runtime-dist'
        output.mkdir(parents=True, exist_ok=True)
        extension = '.zip' if target.startswith('windows_') else '.tar.gz'
        archive = output / f'skillpack-runtime_{version}_{target}{extension}'
        names = [binary.name, cli_binary.name, 'LICENSE', 'NOTICE', 'SOURCE.json']
        if extension == '.zip':
            with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zipped:
                for name in names:
                    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o100644 << 16
                    zipped.writestr(info, (directory / name).read_bytes())
        else:
            with archive.open('wb') as output_file, gzip.GzipFile(filename='', fileobj=output_file, mode='wb', mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode='w') as tar:
                    for name in names:
                        info = tarfile.TarInfo(name)
                        info.size = (directory / name).stat().st_size
                        info.mode = 0o755 if name in (binary.name, cli_binary.name) else 0o644
                        with (directory / name).open('rb') as source:
                            tar.addfile(info, source)
        record = {**metadata, 'name': archive.name, 'size': archive.stat().st_size,
                  'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
        (output / f'{target}.json').write_text(json.dumps(record, sort_keys=True) + '\n')


if __name__ == '__main__':
    main()
