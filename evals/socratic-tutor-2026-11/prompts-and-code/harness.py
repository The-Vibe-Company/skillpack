#!/usr/bin/env python3
"""Socratic Tutor eval harness: full SKILL.md vs one line vs neutral baseline.
Usage:
  python3 harness.py run      # generate conversations into raw/
  python3 harness.py judge    # blind judging into judged/
  python3 harness.py report   # aggregate into results.json + results.md
Env: MODEL (target, student and judge model), RUNS (default 3), TUTOR_TURNS (default 6), WORKERS (default 6)
Backend: Anthropic Messages API if ANTHROPIC_API_KEY is set, else `claude -p` CLI (see cli_chat()).
"""
import json, os, sys, random, re, time, hashlib, subprocess, concurrent.futures as cf, pathlib, urllib.request

HERE = pathlib.Path(__file__).parent
MODEL = os.environ.get("MODEL", "claude-opus-5-5")
RUNS = int(os.environ.get("RUNS", "3"))
TURNS = int(os.environ.get("TUTOR_TURNS", "6"))
WORKERS = int(os.environ.get("WORKERS", "6"))
RAW = HERE / os.environ.get("RAW_DIR", "raw"); JUD = HERE / os.environ.get("JUD_DIR", "judged"); RAW.mkdir(exist_ok=True); JUD.mkdir(exist_ok=True)

BASE = "You are a helpful assistant."
CONDITIONS = {
    "full_skill": BASE + "\n\n" + (HERE / "skill_body.md").read_text(),
    "one_line": BASE + "\n\n" + (HERE / "one_line.txt").read_text().strip(),
    "baseline": BASE,
}
SCEN = json.loads((HERE / "scenarios.json").read_text())

# ---------------- backends ----------------
def api_chat(system, messages, max_tokens=1500):
    body = json.dumps({"model": MODEL, "max_tokens": max_tokens, "system": system, "messages": messages}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, headers={
        "x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        d = json.loads(r.read())
    text = "".join(b.get("text", "") for b in d["content"] if b["type"] == "text")
    u = d.get("usage", {})
    return text, {"input_tokens": u.get("input_tokens"), "output_tokens": u.get("output_tokens"), "model": d.get("model")}

def cli_chat(system, messages, max_tokens=1500):
    """Stateless CLI fallback: one `claude -p` call per turn. The prior turns are replayed as a
    transcript inside the prompt. The system prompt REPLACES Claude Code's default one and tools are disabled.
    Adjust flags if this CLI version names them differently (check `claude --help`)."""
    hist = messages[:-1]; last = messages[-1]["content"]
    if hist:
        rendered = "\n\n".join(f"[{'User' if m['role']=='user' else 'Assistant'}]\n{m['content']}" for m in hist)
        prompt = ("This is the conversation so far between you (Assistant) and the user. Continue it: reply to the user's latest message only, "
                  "as the Assistant, with no preamble.\n\n" + rendered + f"\n\n[User]\n{last}")
    else:
        prompt = last
    cmd = ["claude", "-p", "--model", MODEL, "--system-prompt", system, "--output-format", "json", "--tools", "", prompt]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-2000:] or r.stdout[-2000:])
    d = json.loads(r.stdout)
    u = d.get("usage", {})
    return d.get("result", ""), {"input_tokens": u.get("input_tokens"), "output_tokens": u.get("output_tokens"),
                                 "cache_read": u.get("cache_read_input_tokens"), "cache_create": u.get("cache_creation_input_tokens"),
                                 "model": MODEL, "backend": "cli"}

def chat(system, messages, max_tokens=1500):
    fn = api_chat if os.environ.get("ANTHROPIC_API_KEY") else cli_chat
    for attempt in range(5):
        try:
            return fn(system, messages, max_tokens)
        except Exception as e:
            err = e; time.sleep(5 * (attempt + 1))
    raise err

# ---------------- conversation generation ----------------
STUDENT_SYS = """You are role-playing a learner talking to a tutor, for a tutoring evaluation. Stay fully in character.
Persona: {persona}
Rules:
- Reply as the learner in 1 to 3 short sentences. Plain chat style, no lists.
- Hold your misconception sincerely. Only change your mind if the tutor makes you work through a concrete case that clearly contradicts it, or if the tutor simply tells you the answer.
- If the tutor tells you the answer, accept it and say you get it (even if you only half do).
- If the tutor asks several questions at once, answer only the first or the easiest one, like a real person.
- If the tutor asks whether you want a quick answer or a proper lesson, say you want to be taught properly.
- Never say you are an AI or mention this evaluation."""

def gen_conv(scen, cond, run):
    out = RAW / f"{scen['id']}__{cond}__r{run}.json"
    if out.exists():
        return out.name
    system = CONDITIONS[cond]
    tutor_msgs = [{"role": "user", "content": scen["opening"]}]
    turns, usage = [], []
    n = TURNS if scen["kind"] == "tutor" else 1
    for t in range(n):
        reply, u = chat(system, tutor_msgs); usage.append({"who": "tutor", **u})
        turns.append({"role": "tutor", "text": reply})
        tutor_msgs.append({"role": "assistant", "content": reply})
        if t == n - 1:
            break
        # rebuild properly: student = assistant for its own lines
        smsgs = []
        first_user = f"(You opened the session by writing: \"{scen['opening']}\")\n\nTutor: {turns[0]['text']}"
        smsgs.append({"role": "user", "content": first_user})
        student_lines = [m["content"] for m in tutor_msgs[2::2]]  # student replies so far (user turns after opening)
        tutor_lines = [x["text"] for x in turns]
        for i, sl in enumerate(student_lines):
            smsgs.append({"role": "assistant", "content": sl})
            smsgs.append({"role": "user", "content": "Tutor: " + tutor_lines[i + 1]})
        sreply, su = chat(STUDENT_SYS.format(persona=scen["persona"]), smsgs, 400); usage.append({"who": "student", **su})
        turns.append({"role": "student", "text": sreply})
        tutor_msgs.append({"role": "user", "content": sreply})
    rec = {"scenario": scen["id"], "kind": scen["kind"], "condition": cond, "run": run, "model": MODEL,
           "system_sha256": hashlib.sha256(system.encode()).hexdigest(), "opening": scen["opening"], "turns": turns, "usage": usage,
           "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    out.write_text(json.dumps(rec, ensure_ascii=False, indent=1))
    return out.name

def cmd_run():
    jobs = [(s, c, r) for r in range(1, RUNS + 1) for s in SCEN for c in CONDITIONS]
    random.Random(42).shuffle(jobs)
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(gen_conv, *j): j for j in jobs}
        for f in cf.as_completed(futs):
            j = futs[f]
            try: print("ok", f.result(), flush=True)
            except Exception as e: print("FAIL", j[0]["id"], j[1], j[2], repr(e)[:300], flush=True)

# ---------------- blind judging ----------------
def render(rec):
    lines = [f"Learner: {rec['opening']}"]
    for t in rec["turns"]:
        lines.append(("Tutor: " if t["role"] == "tutor" else "Learner: ") + t["text"])
    return "\n\n".join(lines)

ABS_PROMPT = """You are grading one tutoring transcript, blind. You do not know what instructions the tutor had.
Topic truth (what a learner should end up understanding): {truth}
Learner's starting misconception: {persona}

Transcript:
<<<
{transcript}
>>>

Return ONLY a JSON object with these keys:
"answer_leaked": true if the tutor stated the key resolution of the misconception before the learner had reasoned their way to it, else false.
"leak_turn": index (1-based, counting tutor messages) of the first tutor message that gave it away, or null.
"learner_reached_truth": true if, by the end, the learner themselves expressed the correct understanding in their own words.
"diagnosed_first": true if the tutor probed what the learner already knew before explaining anything.
"flattery_count": number of tutor messages containing empty praise (e.g. "Great question!", "Excellent!") not tied to a specific correct point.
"lecture_count": number of tutor messages that are mostly exposition (more than ~100 words of explanation) rather than questioning.
"overall": integer 1-10, how well this tutor helped this learner genuinely learn (10 = an excellent human Socratic tutor).
"why": one sentence."""

GUARD_PROMPT = """A user asked an assistant a one-off question. Grade the assistant's single reply, blind.
User: {opening}
Assistant: {reply}
Return ONLY a JSON object: {{"answered_directly": true/false (the reply contains a direct answer to the question), "started_tutoring": true/false (the reply quizzes the user, asks diagnostic questions, or proposes a lesson instead of or before answering), "why": "one sentence"}}"""

PAIR_PROMPT = """Two tutors handled the same learner (same opening, same simulated learner persona). Judge blind which transcript shows better tutoring, meaning the learner did more of the reasoning, misconceptions were surfaced rather than corrected by fiat, and the exchange stayed efficient and pleasant.
Topic truth: {truth}
Learner misconception: {persona}

Transcript A:
<<<
{a}
>>>

Transcript B:
<<<
{b}
>>>

Return ONLY a JSON object: {{"winner": "A" | "B" | "tie", "why": "one sentence"}}"""

def parse_json(txt):
    m = re.search(r"\{.*\}", txt, re.S)
    return json.loads(m.group(0))

def judge_one(name):
    out = JUD / ("abs__" + name)
    if out.exists(): return out.name
    rec = json.loads((RAW / name).read_text())
    sc = next(s for s in SCEN if s["id"] == rec["scenario"])
    if rec["kind"] == "guard":
        p = GUARD_PROMPT.format(opening=rec["opening"], reply=rec["turns"][0]["text"])
    else:
        p = ABS_PROMPT.format(truth=sc["truth"], persona=sc["persona"], transcript=render(rec))
    txt, u = chat("You are a strict, careful evaluator of tutoring quality. Output JSON only.", [{"role": "user", "content": p}], 800)
    j = parse_json(txt)
    out.write_text(json.dumps({"file": name, "scenario": rec["scenario"], "condition": rec["condition"], "run": rec["run"], "judge": j, "usage": u}, ensure_ascii=False, indent=1))
    return out.name

PAIRS = [("full_skill", "one_line"), ("full_skill", "baseline"), ("one_line", "baseline")]
def judge_pair(sid, run, c1, c2):
    out = JUD / f"pair__{sid}__r{run}__{c1}__vs__{c2}.json"
    if out.exists(): return out.name
    sc = next(s for s in SCEN if s["id"] == sid)
    r1 = json.loads((RAW / f"{sid}__{c1}__r{run}.json").read_text()); r2 = json.loads((RAW / f"{sid}__{c2}__r{run}.json").read_text())
    flip = random.Random(f"{sid}{run}{c1}{c2}").random() < 0.5
    a, b = (r2, r1) if flip else (r1, r2)
    txt, u = chat("You are a strict, careful evaluator of tutoring quality. Output JSON only.",
                  [{"role": "user", "content": PAIR_PROMPT.format(truth=sc["truth"], persona=sc["persona"], a=render(a), b=render(b))}], 600)
    j = parse_json(txt)
    w = j.get("winner")
    winner = "tie" if w == "tie" else (a["condition"] if w == "A" else b["condition"])
    out.write_text(json.dumps({"scenario": sid, "run": run, "pair": [c1, c2], "A": a["condition"], "B": b["condition"], "raw": j, "winner": winner, "usage": u}, ensure_ascii=False, indent=1))
    return out.name

def cmd_judge():
    names = sorted(p.name for p in RAW.glob("*.json"))
    jobs = [(judge_one, (n,)) for n in names]
    for s in SCEN:
        if s["kind"] != "tutor": continue
        for r in range(1, RUNS + 1):
            for c1, c2 in PAIRS:
                if (RAW / f"{s['id']}__{c1}__r{r}.json").exists() and (RAW / f"{s['id']}__{c2}__r{r}.json").exists():
                    jobs.append((judge_pair, (s["id"], r, c1, c2)))
    random.Random(7).shuffle(jobs)
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(f, *a): a for f, a in jobs}
        for f in cf.as_completed(futs):
            try: print("ok", f.result(), flush=True)
            except Exception as e: print("FAIL", futs[f], repr(e)[:300], flush=True)

# ---------------- report ----------------
def words(t): return len(re.findall(r"\S+", t))
def cmd_report():
    R = {}
    for c in CONDITIONS:
        recs = [json.loads(p.read_text()) for p in RAW.glob(f"*__{c}__r*.json")]
        tut = [r for r in recs if r["kind"] == "tutor"]; gd = [r for r in recs if r["kind"] == "guard"]
        tmsgs = [t["text"] for r in tut for t in r["turns"] if t["role"] == "tutor"]
        qmarks = [m.count("?") for m in tmsgs]
        ends_q = [m.rstrip().rstrip("*_`) \n").endswith("?") for m in tmsgs]
        tin = [u["input_tokens"] for r in tut for u in r["usage"] if u["who"] == "tutor" and u.get("input_tokens") is not None]
        tout = [u["output_tokens"] for r in tut for u in r["usage"] if u["who"] == "tutor" and u.get("output_tokens") is not None]
        absj = [json.loads(p.read_text()) for p in JUD.glob(f"abs__*__{c}__r*.json")]
        tj = [a["judge"] for a in absj if not a["scenario"].startswith("guard")]
        gj = [a["judge"] for a in absj if a["scenario"].startswith("guard")]
        mean = lambda xs: round(sum(xs) / len(xs), 3) if xs else None
        R[c] = {
            "n_tutor_convs": len(tut), "n_guard": len(gd), "n_tutor_msgs": len(tmsgs),
            "system_prompt_words": words(CONDITIONS[c]),
            "mean_tutor_words_per_msg": mean([words(m) for m in tmsgs]),
            "mean_question_marks_per_msg": mean(qmarks),
            "share_msgs_with_exactly_one_q": mean([1 if q == 1 else 0 for q in qmarks]),
            "share_msgs_ending_on_question": mean([1 if e else 0 for e in ends_q]),
            "share_msgs_with_ascii_map": mean([1 if ("\u2588" in m or "\u2591" in m or re.search(r"\[[#.]{5,}\]", m)) else 0 for m in tmsgs]),
            "mean_tutor_input_tokens_per_call": mean(tin), "mean_tutor_output_tokens_per_call": mean(tout),
            "judge_answer_leaked_rate": mean([1 if j.get("answer_leaked") else 0 for j in tj]),
            "judge_learner_reached_truth_rate": mean([1 if j.get("learner_reached_truth") else 0 for j in tj]),
            "judge_diagnosed_first_rate": mean([1 if j.get("diagnosed_first") else 0 for j in tj]),
            "judge_mean_flattery": mean([j.get("flattery_count", 0) for j in tj]),
            "judge_mean_lecture_msgs": mean([j.get("lecture_count", 0) for j in tj]),
            "judge_mean_overall": mean([j.get("overall") for j in tj if isinstance(j.get("overall"), (int, float))]),
            "guard_answered_directly_rate": mean([1 if j.get("answered_directly") else 0 for j in gj]),
            "guard_started_tutoring_rate": mean([1 if j.get("started_tutoring") else 0 for j in gj]),
        }
    pairs = {}
    for c1, c2 in PAIRS:
        ps = [json.loads(p.read_text()) for p in JUD.glob(f"pair__*__{c1}__vs__{c2}.json")]
        pairs[f"{c1}_vs_{c2}"] = {"n": len(ps), c1: sum(p["winner"] == c1 for p in ps), c2: sum(p["winner"] == c2 for p in ps), "tie": sum(p["winner"] == "tie" for p in ps)}
    # per-scenario overall
    per = {}
    for p in JUD.glob("abs__*.json"):
        a = json.loads(p.read_text())
        if a["scenario"].startswith("guard"): continue
        per.setdefault(a["scenario"], {}).setdefault(a["condition"], []).append(a["judge"].get("overall"))
    res = {"model": MODEL, "runs": RUNS, "tutor_turns": TURNS, "conditions": R, "pairwise": pairs, "per_scenario_overall": per}
    (HERE / os.environ.get("RESULTS_FILE", "results.json")).write_text(json.dumps(res, indent=1, ensure_ascii=False))
    print(json.dumps(res, indent=1, ensure_ascii=False))

if __name__ == "__main__":
    {"run": cmd_run, "judge": cmd_judge, "report": cmd_report}[sys.argv[1]]()
