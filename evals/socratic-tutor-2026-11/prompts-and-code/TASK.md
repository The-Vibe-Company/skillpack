# Task: run the Socratic Tutor eval with Claude Code subagents (measurement only)

There is no API key and the `claude` CLI is not logged in inside this sandbox, so every model call in this eval is a
fresh Claude Code `general-purpose` subagent (same model as you). Custom agent files are NOT loaded in this session, so
the role instructions travel inside each job text (shown by `sa_driver.py show`).
State and prompts live in /home/user/eval (sa_driver.py reuses harness.py prompts). Do NOT edit harness.py, sa_driver.py,
scenarios.json, the agent definitions, or any state/ jobs/ file by hand. Measurement only: no git, no PR, no web.
Do NOT read transcripts or job texts yourself (keeps your context small and the run blind). Do not read /home/user/.evalmap.json.

Loop:
1. `cd /home/user/eval && python3 sa_driver.py status`
2. `python3 sa_driver.py next 16` prints up to 16 lines `<job_id> <agent_name>` (or NONE).
3. In ONE message, launch one subagent per line, all in parallel, with the Task/Agent tool:
   subagent_type = general-purpose, description = "eval job", prompt =
   "Job id: <job_id>. Run exactly `python3 /home/user/eval/sa_driver.py show <job_id>` and follow what it prints, exactly. Do not open any other file."
   Do not add anything else to the prompt. Do not run show yourself.
4. When they return, go back to step 2. Repeat until `next` prints NONE AND `status` shows all conversations finished and
   judge results N/N with N = 162 (90 single-transcript grades + 72 pairwise). If `next` prints NONE while some jobs are still
   in flight, wait for them; a job lost for more than 15 minutes is automatically reissued by `next`.
   If subagents cannot run Bash or cannot submit, STOP and explain exactly what failed (do not improvise another method).
5. `python3 sa_driver.py export && TUTOR_TURNS=4 RUNS=3 python3 harness.py report > report.log 2>&1`
6. `cd /home/user && tar czf eval-out.tgz eval .evalmap.json .claude/agents && sha256sum eval-out.tgz`, print /home/user/eval/results.json, and stop.
Write a short /home/user/eval/RUNLOG.md: start/end time, number of rounds, any failed or reissued job ids, anything unusual.
