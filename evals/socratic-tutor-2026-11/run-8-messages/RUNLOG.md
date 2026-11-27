# RUNLOG

## Run 2 (general-purpose subagents, after the state reset)
- Start: 2026-11-18 12:49 UTC
- End: 2026-11-18 13:14 UTC (export and report finished)
- Rounds: 1 check round of 2 jobs, then 54 rounds of up to 16 jobs (the last few conversation rounds had 13, 6, 3, 1 and 1 jobs; the final judge round had 2). 55 rounds in total.
- Final status: conversations 90/90, 522 turns recorded, judge results 162/162, `next` prints NONE, export reported 0 unparseable judge replies.
- Failed jobs: none. Every subagent reported that its submission was recorded.
- Reissued jobs: none timed out. The first `next` calls gave out t_e43ef65216_0 and t_2de330809d_0, the same ids that were issued in the blocked run 1; they appear to be deterministic after the reset.
- Unusual:
  - Judge jobs came out of `next` only after all 90 conversations had finished, even though the judge list was already growing.
  - Some subagents said their own submitted text had a flaw. They could not resubmit, and nothing was edited:
    - t_016d717f6b_5 (learner reply contradicts itself)
    - t_2de330809d_6 (tutor asked two questions in one turn)
    - t_86ed5c74ad_2 (one sentence in the tutor reply came out garbled)
    - abs_bcdca882c6 (the judge's "why" was two sentences instead of one)
  - Several judges said a tutor's worked examples used numbers that differ from the scenario's stated values (for example a 5% or 10% false-positive rate instead of 9%).
  - The subagent final reports often summarised the content of the turns they wrote. Those summaries showed up in the orchestrator's context. I did not read any transcript or job file directly.

## Run 1 (blocked)
- 12:46 UTC: the custom agent types (evaltutor-a etc.) were not available in that session ("Agent type not found"). I stopped without submitting anything.

## Run 3 (8 turns)
- Start: 2026-11-18 13:22 UTC (sha256sum -c SHA256SUMS: all OK). Status at start: 18/90 finished, 522 turns (the guards were already done).
- End: 2026-11-18 13:50 UTC (export and report rc=0, 0 unparseable judge replies).
- Every sa_driver.py and harness.py command ran with `export TUTOR_TURNS=8 RUNS=3`. Outputs went to raw8/, judged8/, results8.json and report8.log. I did not touch raw/, judged/ or results.json.
- Rounds: 49 in total.
  - 40 conversation rounds; the last few had 11, 4 and 1 jobs.
  - 9 judge rounds of 16.
- Final status: 90/90 conversations finished, 1098 turns recorded, judge results 144/144, `next` prints NONE.
- Failed jobs: none. Reissued jobs: none (no job timed out). Every subagent reported "recorded".
- Unusual:
  - Several pair8_ judge jobs used one extra tool call because the `show` output was too long to display inline. The tool saved it to a temp file under /home/user/.armada-runtime/, and the subagent read that file (or re-ran `show` in pieces). Subagents said they opened no other file. Affected jobs include:
    - pair8_2430fd8b7b
    - pair8_e770949ac2
    - pair8_3ac6e943e3
    - pair8_5d03f9e985
    - pair8_c2edc91512
    - pair8_71806da094
    - pair8_2de284cd55
    - pair8_87ca4f0377
    - pair8_92b3b4ff2b
    - pair8_1555959790
    - pair8_1500f17349
    - pair8_303ef106f3
    - pair8_cca6f8126f
    - pair8_886a99841b
    - pair8_d1a6ceeb4a (used 6 tool calls)
  - Some subagents said their own submitted text had a flaw; they could not resubmit:
    - t_fb6ff00f99_10: a tutor sentence about loss CAGR is backwards.
    - t_2e0b55880e_10: one muddled paragraph.
    - t_3b7c3cf486_12: the opening lines are in an awkward order.
  - As in run 2, judges flagged tutor examples that used different numbers from the scenario truth (5% or 10% false-positive rate instead of 9%).
  - Judge jobs came out of `next` only after all conversations had finished.
  - TASK8 step 4 says to build eval-out8.tgz before appending this section, so the tarball holds RUNLOG.md without it. eval-out8.tgz sha256: 2562bd3d07a769489d07ce8bbdd3f0fc0294db03ebe973c0c5a55561af8b16c2
