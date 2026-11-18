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
