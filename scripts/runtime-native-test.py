#!/usr/bin/env python3
"""Exercise the actual native executable, offline, with an isolated state directory."""
import json
import hashlib
import shutil
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile


def main():
    binary = str(Path(sys.argv[1]).resolve())
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

        invoke('register', '--inventory', str(path))
        event = {'hook_event_name': 'PostToolUse', 'session_id': 'private-session', 'cwd': str(root),
                 'tool_name': 'Skill', 'tool_use_id': 'call-1', 'tool_input': {'skill': 'example'},
                 'tool_response': {'success': True}, 'prompt': 'private prompt must never appear on the wire'}
        assert invoke('hook', '--agent', 'claude-code', payload=event)['captured'] is True
        invoke('hook', '--agent', 'claude-code', payload=event)
        assert invoke('doctor', '--json')['queue']['pending'] == 1
        with sqlite3.connect(state / 'runtime.sqlite3') as db:
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
        assert not completed.stdout and not completed.stderr
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
        assert not completed.stdout and not completed.stderr
        with sqlite3.connect(state / 'runtime.sqlite3') as db:
            events = db.execute("SELECT payload FROM events WHERE agent='opencode'").fetchall()
        assert len(events) == 1
        assert json.loads(events[0][0])['adapter'] == 'opencode-plugin'
        assert 'private' not in str(events)
        invoke('telemetry', 'disable')
        assert invoke('doctor', '--json')['queue']['pending'] == 0
        print('Native executable: verified inventory, durable redacted capture, dedupe and persistent opt-out passed.')


if __name__ == '__main__':
    main()
