#!/usr/bin/env python3
"""Print one raw run as readable lines: python3 dump.py raw/A-1.jsonl"""
import json, sys
for l in open(sys.argv[1]):
    e = json.loads(l)
    for b in (e.get("message") or {}).get("content") or []:
        if not isinstance(b, dict): continue
        if e["type"] == "assistant" and b.get("type") == "text": print("TEXT:", b["text"][:600])
        if b.get("type") == "tool_use": print("TOOL:", b["name"], json.dumps(b["input"])[:400])
        if b.get("type") == "tool_result":
            c = b.get("content"); c = c if isinstance(c, str) else json.dumps(c)
            print("  ->", c[:300].replace("\n", " | "))
