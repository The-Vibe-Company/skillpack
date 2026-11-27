# Socratic Tutor skill vs a one-line prompt: harness, prompts and transcripts

Everything behind the skillpack.app article "Jane Street's Socratic Tutor skill vs a one-line prompt" (test run on 18 November 2026).

Read PROTOCOL.md first: design, conditions, limits and the headline numbers.

## Layout

- `PROTOCOL.md`: design, conditions, results, limits.
- `prompts-and-code/`
  - `harness.py`: tutoring loop, learner prompt (`STUDENT_SYS`), judge prompts (`ABS_PROMPT`, `PAIR_PROMPT`, `GUARD_PROMPT`), aggregation.
  - `sa_driver.py`: driver that sends each model call to a fresh subagent.
  - `scenarios.json`: the 8 tutoring scenarios and the guard questions.
  - `skill_body.md`, `skill_full.md`, `one_line.txt`: the three tutor instruction sets (full skill, one line, and the base prompt only).
  - `TASK.md`, `TASK8.md`: instructions given to the subagents for the 4-message and 8-message runs.
  - `CHANGES-run1-blocked.md`: log of the first attempt, which produced no data.
- `run-4-messages/`: `raw/` tutoring transcripts, `state/` conversation state, `judged/` judge outputs, `results.json`, run logs.
- `run-8-messages/`: same sessions continued to 8 tutor messages: `raw8/`, `judged8/`, `results8.json`, run logs.

## Notes

- Model: Claude Opus 5.5 played tutor, simulated learner and judge, each call a fresh Claude Code subagent with no shared memory.
- The skill is Jane Street's `socratic-tutor` SKILL.md (MIT), pasted as the prompt, not installed as a skill.
- Limits: simulated learner, same-family judge, 8 topics x 3 runs. See the article and PROTOCOL.md.
- No API keys or credentials are included. The code reads `ANTHROPIC_API_KEY` from the environment only if you run it against the API.
