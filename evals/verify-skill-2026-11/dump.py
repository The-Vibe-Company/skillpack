#!/usr/bin/env python3
"""Print a readable, verbatim view of one raw stream-json run (tool calls, results, text)."""
import json, sys
for l in open(sys.argv[1]):
    try: e = json.loads(l)
    except Exception: continue
    t = e.get("type")
    if t == "assistant":
        for c in e["message"]["content"]:
            if c["type"] == "tool_use": print("TOOL_USE", c["name"], json.dumps(c["input"], ensure_ascii=False))
            elif c["type"] == "text": print("TEXT", c["text"])
    elif t == "user":
        cont = e["message"]["content"]
        if isinstance(cont, list):
            for c in cont:
                if c.get("type") == "tool_result":
                    x = c.get("content")
                    if isinstance(x, list): x = " ".join(i.get("text", "") for i in x if isinstance(i, dict))
                    print("TOOL_RESULT", "(error)" if c.get("is_error") else "", str(x)[:int(sys.argv[2]) if len(sys.argv) > 2 else 600])
                elif c.get("type") == "text": print("USER_TEXT", c["text"][:600])
        else: print("USER_TEXT", str(cont)[:600])
    elif t == "result": print("RESULT", e.get("subtype"), e.get("num_turns"), "|", e.get("result"))
