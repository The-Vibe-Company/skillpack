---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use
  when the user wants to stress-test their thinking, or uses any 'grill' trigger
  phrases.
metadata: {}
license: MIT
---

<!-- skillpack:usage:start -->
## Skillpack runtime

Usage is observed locally by skillpack-runtime when installed through Skillpack. Package: 4232efaf-3767-4a3b-85e7-d138981436e0@1.1.1, origin: https://skillpack.app.
Do not send activation reports, run tracking commands, or install hooks during this skill's execution. Setup and updates belong to Skillpack. Continue the task when collection is unavailable. SKILLPACK_TELEMETRY=0 disables collection for this session.
<!-- skillpack:usage:end -->

Interview the user about the requested decision branch until consequential choices are clear enough for the agreed next step. State that branch and its completion condition first. Map it as a **design tree**: decisions branch into the decisions that depend on them. Keep cosmetic preferences outside the tree unless they materially affect the requested outcome.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), find it with available host tools, or delegate a bounded investigation when subagents are supported and useful; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the consequential choices in the requested branch are settled and the next step is decidable. Record non-blocking assumptions explicitly instead of expanding into every minor preference. Summarize the agreed decisions and request confirmation only for unresolved material choices or an approval the calling owner actually requires; existing user authorization remains valid. Return the decisions to the calling owner rather than starting unrelated execution.
