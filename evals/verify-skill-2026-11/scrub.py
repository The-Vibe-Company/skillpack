#!/usr/bin/env python3
"""Scrub raw stream-json logs before publishing. Changes are limited to:
1. drop whole `rate_limit_event` lines (account plan/usage data, not experiment output);
2. replace every `session_id` value with "REDACTED";
3. replace Armada MCP connector ids (armada_<uuid>) with "armada_REDACTED";
4. replace session ids nested inside escaped strings (tool output that echoed
   other logs) with "REDACTED".
Nothing else is touched. Prints a per-file count of each change.
"""
import json
import re
import sys
from pathlib import Path

NESTED_SID = re.compile(r'(session_id(?:\\\\)*\\"?:(?:\\\\)*\\"?)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
ARMADA = re.compile(r"armada_[0-9a-f]{8}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{12}")

for path in sys.argv[1:]:
    p = Path(path)
    out, dropped, sids, armada = [], 0, 0, 0
    for line in p.read_text().splitlines():
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            out.append(line)
            continue
        if e.get("type") == "rate_limit_event":
            dropped += 1
            continue
        if "session_id" in e:
            e["session_id"] = "REDACTED"
            sids += 1
        s = json.dumps(e, ensure_ascii=False)
        s, n = ARMADA.subn("armada_REDACTED", s)
        armada += n
        s, n2 = NESTED_SID.subn(r"\1REDACTED", s)
        sids += n2
        out.append(s)
    p.write_text("\n".join(out) + "\n")
    print(f"{p.name}: dropped rate_limit_event lines={dropped}, session_id redacted={sids}, armada ids redacted={armada}")
