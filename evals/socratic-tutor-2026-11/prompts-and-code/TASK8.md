# Task 2: extend the same tutor conversations from 4 to 8 tutor turns, then judge again (measurement only)

Same rules as TASK.md (general-purpose subagents, exact prompt from TASK.md step 3, never hand-edit files, do not read transcripts or job texts).
sa_driver.py and harness.py were updated for this (job ids for the 8-turn horizon start with abs8_ / pair8_; outputs go to raw8/, judged8/, results8.json). Guards are not re-judged.
Every command below must run with: `export TUTOR_TURNS=8 RUNS=3` (set it once in each shell command).

1. `cd /home/user/eval && sha256sum -c SHA256SUMS && export TUTOR_TURNS=8 RUNS=3 && python3 sa_driver.py status` (expect 18/90 finished, 522 turns: the 18 guards are already done).
2. Loop exactly like TASK.md step 2 to 4, always with `export TUTOR_TURNS=8 RUNS=3 &&` before `python3 sa_driver.py next 16`, until next prints NONE and status shows 90/90 finished and judge results 144/144 (72 grades + 72 pairwise).
3. `export TUTOR_TURNS=8 RUNS=3 && RAW_DIR=raw8 JUD_DIR=judged8 python3 sa_driver.py export && RAW_DIR=raw8 JUD_DIR=judged8 RESULTS_FILE=results8.json python3 harness.py report > report8.log 2>&1`
4. `cd /home/user && tar czf eval-out8.tgz eval/raw8 eval/judged8 eval/results8.json eval/state eval/jobs eval/RUNLOG.md && sha256sum eval-out8.tgz`, print results8.json, append a "Run 3 (8 turns)" section to RUNLOG.md (rounds, failures, anything unusual), and stop.
Do not touch raw/, judged/ or results.json from run 2.
