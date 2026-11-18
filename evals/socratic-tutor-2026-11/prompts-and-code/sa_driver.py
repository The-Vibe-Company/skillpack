#!/usr/bin/env python3
"""Subagent driver for the Socratic Tutor eval (no API key in the sandbox, so every model call is a
fresh Claude Code subagent with a custom agent definition; see .claude/agents/).
  python3 sa_driver.py init                 # write agent definitions + conversation state
  python3 sa_driver.py next [N]             # print up to N ready jobs: "<job_id> <agent_name>"
  python3 sa_driver.py submit <job_id>      # (called by subagents) read reply on stdin, record it
  python3 sa_driver.py status               # progress counts
  python3 sa_driver.py export               # write raw/ and judged/ in harness.py format
Reuses prompts from harness.py unchanged.
"""
import json, os, sys, hashlib, random, pathlib, re, time
os.environ.setdefault("ANTHROPIC_API_KEY", "")  # harness import only
import harness as H

HERE = pathlib.Path(__file__).parent.resolve()
ST = HERE / "state"; JOBS = HERE / "jobs"; ST.mkdir(exist_ok=True); JOBS.mkdir(exist_ok=True)
AG = pathlib.Path(os.environ.get("AGENTS_DIR", "/home/user/.claude/agents"))
RUNS = int(os.environ.get("RUNS", "3")); TURNS = int(os.environ.get("TUTOR_TURNS", "4"))
MAP = pathlib.Path(os.environ.get("EVALMAP", "/home/user/.evalmap.json"))  # condition mapping, NOT to be read by subagents

HARNESS_NOTE = """

---
Harness note (technical, not part of your role): a script runs you one turn at a time. The task message gives you a job id.
1. Run exactly: python3 /home/user/eval/sa_driver.py show JOB_ID
2. Read what it prints, then write your reply (and nothing else) by running:
python3 /home/user/eval/sa_driver.py submit JOB_ID <<'REPLY_EOF'
<your reply here>
REPLY_EOF
3. Then stop. Do not read or list any other file. Do not use any other tool. Your final answer to the script can be just: done."""

JUDGE_SYS = "You are a strict, careful evaluator of tutoring quality. Output JSON only."
COND_AGENT = {"full_skill": "evaltutor-a", "one_line": "evaltutor-b", "baseline": "evaltutor-c"}

def cid(s, c, r): return hashlib.sha256(f"{s}|{c}|{r}|socratic".encode()).hexdigest()[:10]
def load(p): return json.loads(p.read_text())
def save(p, d):
    tmp = p.with_suffix(".tmp"); tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1)); tmp.replace(p)

def agent_md(name, desc, body):
    return f"---\nname: {name}\ndescription: {desc}\ntools: Bash\nmodel: inherit\n---\n\n{body.strip()}\n"

def init():
    AG.mkdir(parents=True, exist_ok=True)
    for c, a in COND_AGENT.items():
        (AG / f"{a}.md").write_text(agent_md(a, "Eval assistant variant. Only used by the eval script.", H.CONDITIONS[c] + HARNESS_NOTE))
    (AG / "evallearner.md").write_text(agent_md("evallearner", "Eval learner simulator. Only used by the eval script.",
        "You are role-playing a learner talking to a tutor, for a tutoring evaluation. The job text gives your persona and rules. Stay fully in character." + HARNESS_NOTE))
    (AG / "evaljudge.md").write_text(agent_md("evaljudge", "Eval blind judge. Only used by the eval script.", JUDGE_SYS + HARNESS_NOTE))
    mp = {}
    for s in H.SCEN:
        for c in H.CONDITIONS:
            for r in range(1, RUNS + 1):
                i = cid(s["id"], c, r); mp[i] = [s["id"], c, r]
                p = ST / f"conv_{i}.json"
                if not p.exists():
                    save(p, {"id": i, "scenario": s["id"], "kind": s["kind"], "opening": s["opening"], "turns": [], "pending": None})
    MAP.write_text(json.dumps(mp))
    print("init ok", len(mp), "conversations; agents in", AG)

def conv_job(conv):
    s = next(x for x in H.SCEN if x["id"] == conv["scenario"])
    n_tut = sum(t["role"] == "tutor" for t in conv["turns"])
    limit = TURNS if conv["kind"] == "tutor" else 1
    last = conv["turns"][-1]["role"] if conv["turns"] else "learner"
    if n_tut >= limit and last == "tutor": return None
    cond = load(MAP)[conv["id"]][1]
    if last == "learner":  # tutor's turn
        msgs = [("User", conv["opening"])] + [("User" if t["role"] == "learner" else "Assistant", t["text"]) for t in conv["turns"]]
        hist = "\n\n".join(f"[{w}]\n{t}" for w, t in msgs[:-1])
        if hist:
            text = ("This is the conversation so far between you (Assistant) and the user. Continue it: write only your reply to the user's latest message, as the Assistant, with no preamble.\n\n"
                    + hist + f"\n\n[User]\n{msgs[-1][1]}")
        else:
            text = "The user's message:\n\n" + msgs[-1][1] + "\n\nWrite only your reply to the user, with no preamble."
        instr = H.CONDITIONS[cond]
        text = ("You are the assistant in a chat with a user. Instructions for this conversation (loaded for you, the way a skill or system prompt would be):\n<<<\n"
                + instr + "\n>>>\n\n" + text)
        return {"agent": "general-purpose", "role": "tutor", "text": text}
    # learner's turn
    lines = [f"(You opened the session by writing: \"{conv['opening']}\")"]
    for t in conv["turns"]:
        lines.append(("Tutor: " if t["role"] == "tutor" else "You: ") + t["text"])
    text = H.STUDENT_SYS.format(persona=s["persona"]) + "\n\nConversation so far:\n\n" + "\n\n".join(lines) + "\n\nWrite only your next message as the learner."
    return {"agent": "general-purpose", "role": "learner", "text": text}

def all_convs(): return [load(p) for p in sorted(ST.glob("conv_*.json"))]

def judge_jobs():
    convs = {c["id"]: c for c in all_convs()}
    mp = load(MAP)
    done = lambda c: c["turns"] and c["turns"][-1]["role"] == "tutor" and sum(t["role"] == "tutor" for t in c["turns"]) >= (TURNS if c["kind"] == "tutor" else 1)
    def render(c):
        lines = [f"Learner: {c['opening']}"] + [("Tutor: " if t["role"] == "tutor" else "Learner: ") + t["text"] for t in c["turns"]]
        return "\n\n".join(lines)
    out = []
    for i, c in convs.items():
        if not done(c): continue
        s = next(x for x in H.SCEN if x["id"] == c["scenario"])
        jid = ("abs_" if TURNS == 4 else f"abs{TURNS}_") + i
        if c["kind"] == "guard" and TURNS != 4: continue
        if c["kind"] == "guard":
            txt = H.GUARD_PROMPT.format(opening=c["opening"], reply=c["turns"][0]["text"])
        else:
            txt = H.ABS_PROMPT.format(truth=s["truth"], persona=s["persona"], transcript=render(c))
        out.append((jid, txt, {"type": "abs", "conv": i}))
    for s in H.SCEN:
        if s["kind"] != "tutor": continue
        for r in range(1, RUNS + 1):
            for c1, c2 in H.PAIRS:
                i1, i2 = cid(s["id"], c1, r), cid(s["id"], c2, r)
                if not (done(convs[i1]) and done(convs[i2])): continue
                flip = random.Random(f"{s['id']}{r}{c1}{c2}").random() < 0.5
                a, b = (i2, i1) if flip else (i1, i2)
                jid = ("pair_" if TURNS == 4 else f"pair{TURNS}_") + hashlib.sha256(f"{a}{b}".encode()).hexdigest()[:10]
                txt = H.PAIR_PROMPT.format(truth=s["truth"], persona=s["persona"], a=render(convs[a]), b=render(convs[b]))
                out.append((jid, txt, {"type": "pair", "A": a, "B": b}))
    return out

def nxt(n):
    ready = []
    for c in all_convs():
        if c["pending"]: 
            if time.time() - c["pending"]["t"] < 900: continue  # in flight
        j = conv_job(c)
        if j:
            jid = f"t_{c['id']}_{len(c['turns'])}"
            c["pending"] = {"job": jid, "t": time.time()}; save(ST / f"conv_{c['id']}.json", c)
            save(JOBS / f"{jid}.json", {"job": jid, "conv": c["id"], **j}); ready.append((jid, j["agent"]))
    if not ready:
        for jid, txt, meta in judge_jobs():
            res = JOBS / f"{jid}.result.json"
            if res.exists(): continue
            jp = JOBS / f"{jid}.json"
            if jp.exists() and time.time() - load(jp)["t"] < 900: continue
            save(jp, {"job": jid, "agent": "general-purpose", "role": "judge", "text": JUDGE_SYS + "\n\n" + txt, "meta": meta, "t": time.time()}); ready.append((jid, "general-purpose"))
    random.shuffle(ready)
    for jid, a in ready[:n]: print(jid, a)
    # release the ones not handed out
    for jid, a in ready[n:]:
        jp = JOBS / f"{jid}.json"; d = load(jp)
        if d["role"] == "judge": jp.unlink()
        else:
            c = load(ST / f"conv_{d['conv']}.json"); c["pending"] = None; save(ST / f"conv_{d['conv']}.json", c); jp.unlink()
    if not ready: print("NONE")

SUBMIT_NOTE = """

=====
How to answer (technical, not part of the role above): put your reply, and nothing else, in this command and run it once:
python3 /home/user/eval/sa_driver.py submit {jid} <<'REPLY_EOF'
<your reply here>
REPLY_EOF
Then stop. Do not read, list or open any other file, and do not use any other tool. Your final message can be just: done."""
def show(jid): print(load(JOBS / f"{jid}.json")["text"] + SUBMIT_NOTE.format(jid=jid))

def submit(jid):
    reply = sys.stdin.read().strip()
    if not reply: print("empty reply, not recorded"); sys.exit(1)
    d = load(JOBS / f"{jid}.json")
    if d["role"] == "judge":
        save(JOBS / f"{jid}.result.json", {"job": jid, "meta": d["meta"], "reply": reply, "t": time.time()}); print("recorded"); return
    p = ST / f"conv_{d['conv']}.json"; c = load(p)
    if not c["pending"] or c["pending"]["job"] != jid: print("stale job, ignored"); return
    c["turns"].append({"role": d["role"], "text": reply}); c["pending"] = None; save(p, c); print("recorded")

def status():
    cs = all_convs(); mp = load(MAP)
    fin = sum(1 for c in cs if conv_job(c) is None); turns = sum(len(c["turns"]) for c in cs)
    jj = judge_jobs(); jd = sum(1 for j in jj if (JOBS / f"{j[0]}.result.json").exists())
    print(f"conversations finished {fin}/{len(cs)}; turns recorded {turns}; judge results {jd}/{len(jj)} (judge list grows as conversations finish)")

def export():
    mp = load(MAP); H.RAW.mkdir(exist_ok=True); H.JUD.mkdir(exist_ok=True)
    for c in all_convs():
        s, cond, r = mp[c["id"]]
        rec = {"scenario": s, "kind": c["kind"], "condition": cond, "run": r, "model": "claude-opus-5-5 (Claude Code general-purpose subagent, instructions in the task prompt)",
               "system_sha256": hashlib.sha256(H.CONDITIONS[cond].encode()).hexdigest(), "opening": c["opening"],
               "turns": [{"role": "tutor" if t["role"] == "tutor" else "student", "text": t["text"]} for t in c["turns"]], "usage": [], "conv_id": c["id"]}
        H.RAW.joinpath(f"{s}__{cond}__r{r}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1))
    bad = 0
    pre = ("abs_", "pair_") if TURNS == 4 else (f"abs{TURNS}_", f"pair{TURNS}_")
    for p in JOBS.glob("*.result.json"):
        if not p.name.startswith(pre): continue
        d = load(p); m = d["meta"]
        try: j = H.parse_json(d["reply"])
        except Exception: bad += 1; continue
        if m["type"] == "abs":
            s, cond, r = mp[m["conv"]]
            name = f"{s}__{cond}__r{r}.json"
            H.JUD.joinpath("abs__" + name).write_text(json.dumps({"file": name, "scenario": s, "condition": cond, "run": r, "judge": j, "usage": {}}, ensure_ascii=False, indent=1))
        else:
            sa, ca, ra = mp[m["A"]]; sb, cb, rb = mp[m["B"]]
            pair = next(pp for pp in H.PAIRS if set(pp) == {ca, cb})
            w = j.get("winner"); winner = "tie" if w == "tie" else (ca if w == "A" else cb)
            H.JUD.joinpath(f"pair__{sa}__r{ra}__{pair[0]}__vs__{pair[1]}.json").write_text(json.dumps(
                {"scenario": sa, "run": ra, "pair": list(pair), "A": ca, "B": cb, "raw": j, "winner": winner, "usage": {}}, ensure_ascii=False, indent=1))
    print("exported; unparseable judge replies:", bad)

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "init": init()
    elif cmd == "next": nxt(int(sys.argv[2]) if len(sys.argv) > 2 else 12)
    elif cmd == "show": show(sys.argv[2])
    elif cmd == "submit": submit(sys.argv[2])
    elif cmd == "status": status()
    elif cmd == "export": export()
