# Socratic Tutor skill vs one line: protocol and raw results (18 Nov 2026, Europe/Paris)

## Design (SkillOpt / Skill Creator style: frozen model, held-out cases, blind judge, baseline)
- Conditions (same model claude-opus-5-5 for tutor, learner simulator, judge):
  A full_skill = "You are a helpful assistant." + body of janestreet/agent_skills socratic-tutor/SKILL.md (commit 7c6715c2, MIT)
  B one_line = base + arshxyz's HN line (verbatim, itself copied from the skill)
  C baseline = base only
- 8 tutoring scenarios with a misconception persona + 2 one-off "guard" questions (prompts-and-code/scenarios.json). 3 runs each = 72 tutoring sessions + 18 guard answers.
- Learner simulated by a separate fresh call (prompts-and-code/harness.py STUDENT_SYS).
- Horizons: 4 tutor messages (run 2), same sessions continued to 8 tutor messages (run 3).
- Blind judge: per-transcript rubric (prompts-and-code/harness.py ABS_PROMPT / GUARD_PROMPT) + pairwise A/B with seeded random order (PAIR_PROMPT); judge never sees instructions or condition names.
- Execution: no API key / CLI login in Armada sandboxes (attempt 1 blocked, prompts-and-code/CHANGES-run1-blocked.md), so every model call = a fresh Claude Code general-purpose subagent in Armada sandbox 4314ea09 (golden native-linear-modal), driven by prompts-and-code/sa_driver.py; instructions travel in the job text (README of the skill says to paste the body into the chat or system prompt for plain chatbots).
- Limits: simulated learner, same-family judge, small sample, no token counts (words instead), pairwise 15-9 not statistically strong (sign test p ~ 0.3); 24-0 results are.

## Results
4 messages (run-4-messages/results.json, sha of tgz ff29d369...): pairwise skill vs line 10-14, skill vs base 20-4, line vs base 22-2; leaked 6/20/23 of 24; learner reached truth 0/12/18 of 24; judge mean 5.04/5.29/4.29; words/msg 101/238/383; guards 6/6 direct in all conditions.
8 messages (run-8-messages/results8.json, eval-out8 sha 2562bd3d...; min tarball eval-out8-min.tgz b9f787ef...): pairwise skill vs line 15-9, skill vs base 24-0, line vs base 24-0; leaked 8/19/24; truth 4/21/21; judge mean 7.08/6.00/4.46; words/msg 125/241/330; one-question share 58%/23%/24%; ASCII skill map in 12.5% of skill messages.

## Files
See README.md. prompts-and-code/ (harness, driver, scenarios, tutor variants), run-4-messages/ and run-8-messages/ (raw transcripts, judge outputs, results).
