---
title: "Socratic Tutor Skill vs One-Line Prompt: The Verdict Flips"
description: "Jane Street's Socratic Tutor skill vs the one-line prompt from Hacker News: a blind test where the lead changes between message four and message eight."
slug: socratic-tutor-skill-vs-one-line-prompt
date: 2026-11-18
dataCollected: 2026-11-18
tags: ["Socratic Tutor", "Jane Street", "Agent Skills", "SKILL.md", "Skill evals", "Skills vs prompts"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
---

# Does the Socratic Tutor skill beat the one line Hacker News said would do?

Jane Street's [Socratic Tutor skill](https://github.com/janestreet/agent_skills/blob/master/socratic-tutor/SKILL.md) is 854 words of instructions for turning a chatbot into a strict teacher. On Hacker News, a commenter named arshxyz had used it for a week or so, preferred it to the bare model, and still [figured one line gets you most of the effect](https://news.ycombinator.com/item?id=50464352). This line: "When the user is wrong, do not give the answer. Ask a narrower question that exposes the contradiction in their reasoning."

It's a good line. It's also Jane Street's. It sits word for word inside the skill's teaching loop, so the "one line would do" argument was really one piece of the skill arguing against the rest of it.

That makes the argument testable. A notebook test put three tutors in front of the same stubborn learners: the full skill, the one line, and no instructions at all. A judge that couldn't tell which was which picked the better session. The solid result is that both sets of instructions beat no instructions, in all 24 comparisons by message eight. Between the two, it's closer. After four tutor messages, the judge preferred the one line in 14 of 24 comparisons, a slight edge and too close to call. After eight, it preferred the full skill, 15 to 9. Same sessions, four messages later. Whether the skill beats the prompt depends on where you stop reading. The stranger finding is where the skill slipped: when its tutor gave the answer away, it was mostly in its very first message.

## The thread argued about the Socratic Tutor with no numbers on either side

The [Hacker News thread](https://news.ycombinator.com/item?id=50438261) reached 721 points and 171 comments. The repository behind it, [janestreet/agent_skills](https://github.com/janestreet/agent_skills), had about 10,000 stars on November 18, 2026, and it holds exactly this one skill.

The skeptics had [mw888](https://news.ycombinator.com/item?id=50464553): "Every single skill I see just strikes me as a prompt." They had [pkoird](https://news.ycombinator.com/item?id=50469013) too, who doubted you need a skill at all, because if you just ask the model to coach you with the Socratic method, "it already does a pretty great job."

The other side had [lemax](https://news.ycombinator.com/item?id=50465114): "I've struggled to get AI to teach me things well without spilling hints or giving answers away. Assuming this was built on some solid evals this could be awesome."

Assuming. No one in the thread posted a measurement, for the skill or for the one line. Both camps were going on feel.

None of this is a knock on Jane Street. The skill is free under [the MIT license](https://github.com/janestreet/agent_skills/blob/master/LICENSE.md), and its README is modest: the prior-art note points out that teaching by asking questions is "rather older than LLMs." The README even tells people on a plain chatbot to "paste the body of the skill's SKILL.md into the chat." And if a skill is a prompt you can paste, you can paste a shorter one next to it and compare. (If the format is new to you, here's [what a SKILL.md file is and what goes in it](/blog/what-is-skill-md).)

## Four messages in, the one line led and the skill was still asking questions

So the notebook built a small classroom. It picked eight topics and gave each one a simulated learner, played by a second model instance. Each learner holds one classic misconception and keeps it until a concrete case contradicts it or the tutor simply gives the answer. Told the answer, the learner was instructed to accept it and say it gets it, even if it only half does. The topics are familiar traps: what 0.1 + 0.2 gives in floating point, Monty Hall, recovering from a 50% loss, Python's mutable default arguments.

Three tutors met each learner three times. One carried the 793-word body of the SKILL.md (the file minus its frontmatter), one carried arshxyz's line, and one carried only "You are a helpful assistant." A separate judge, never shown the instructions, compared the transcripts two at a time: 24 comparisons for each pair of tutors.

The first reading came after four tutor messages, and the one line came out slightly ahead. The SKILL.md says: "Do not teach anything until the diagnostic is done." The skill's tutor spent its opening on placement questions. When the learner said something wrong, the tutor filed the error for later. One reply reads: "Noted. I'll come back to this one too once the diagnostic is done." The judge's notes keep saying the tutor "never addresses the misconception" and "withholds all feedback." By the fourth message, the learner had stated the right understanding in 0 of the skill's 24 sessions.

Meanwhile the one line was doing something strange for a Socratic prompt. It was lecturing. The rule only fires "when the user is wrong," and at the start of a session the learner hasn't had a chance to be wrong yet. In most sessions the model opened with a full lecture. One first message, on the investing topic, ran 739 words. After the lecture, the rule woke up and the tutor asked good narrowing questions, which fits the judge's slight preference at this length.

This reading hides a second trap. Count only whether the learner held the right idea by message four, and the winner is the tutor with no instructions: 18 of 24 sessions, against 12 for the one line. It got there by giving the answer away in 23 of its 24 sessions and letting the learner repeat it. The one line gave the answer away in 20, the skill in 6. One number, read alone, would have crowned the tutor that just tells you.

At four messages the one line had a slight edge, 14 to 10, too close to call on its own, for a reason nobody in the thread gave. Then the sessions kept going.

## Four messages later the verdict flipped, and the skill's costs showed up

The skill's tutor gave the answer away in 8 of 24 sessions, against 19 for the one line, and the gap was already there at message four, 6 against 20. The surprise is where the skill leaked. Six of its eight giveaways came in the very first message: the list of subskills it announces before the diagnostic spelled out the answer, such as "-50% needs +100%" on the investing topic. Only two came later, both on the Bayes topic, at messages five and six.

Those counts come from the second reading. The same sessions ran on to eight tutor messages, in front of the same blind judge, and this time the judge leaned to the full skill, 15 comparisons to 9. The figure shows comparisons won out of 24 at each reading, with the two lines crossing.

![The one-line prompt leads at four tutor messages; the Socratic Tutor skill wins 15 to 9 by message eight. Detailed below.](/images/blog/socratic-tutor-skill-vs-one-line-prompt/socratic-tutor-verdict-flips.png)

Both sets of instructions beat the tutor with none, 24 to 0 each. The table has the rest of the eight-message reading.

| After 8 tutor messages | Full skill (793-word body) | One line (21 words) | No instructions |
|---|---|---|---|
| Tutor gave away the key answer before the learner reasoned it out | 8 of 24 | 19 of 24 | 24 of 24 |
| Learner stated the right understanding in their own words | 4 of 24 | 21 of 24 | 21 of 24 |
| Judge's average score (1 to 10) | 7.1 | 6.0 | 4.5 |
| Average words per tutor message | 125 | 241 | 330 |
| Tutor messages asking exactly one question | 58% | 23% | 24% |

Read it as a ledger, with one caution: each column is a whole set of instructions, so a row prices the file, never one section of it.

The skill's messages are about half as long as the one line's, and more than twice as likely to hold exactly one question. That fits the skill's "ONE question at a time" rule, but the test never removed the rule, so it can't say which part of the file does it. On that last count, the one line does no better than no instructions.

arshxyz's line is the cheapest entry in the ledger, and it earns its keep. Read the judge's row from right to left: one sentence buys the first step up from nothing, and the rest of the file buys a second, smaller step. "Most of the effect" was a fair guess on that row. What the line can't buy is a quiet opening. It has no say until the learner is wrong, and by then the lecture has already happened.

The second row cuts against the skill. After eight messages, few of its learners had put the right idea into their own words. The test can't say why. The diagnostic is one candidate; the learner's rule to accept any answer it's told is another. The skill is built for long mastery sessions, with a skill map, spaced review and a final assessment, and eight messages is early in that design. The test stopped there, so what happens next is unmeasured.

One section of the skill, the guard, tells the model to answer one-off questions normally and leave the tutoring loop alone. The test asked two of those ("what does HTTP 304 mean?" was one), three times per tutor, and all 18 answers came back direct, with the guard and without it. On this test, that section bought nothing measurable.

That leaves a verdict for each kind of session. For a short one, or quick help, the one line is enough. For a long mastery session, take the skill, knowing that nothing past eight messages was tested. For a one-off question you need neither.

*Method: the notebook test ran on November 18, 2026, with Claude Opus 5.5 (arshxyz's comment mentions "Opus 5.5 on Medium") playing tutor, learner and judge, each call a fresh Claude Code subagent with no shared memory. It covered 72 tutoring sessions, compared head to head at both lengths. The skill's body was pasted in as the prompt, the way Jane Street's README describes for a plain chatbot; it wasn't installed as a skill. Its limits: the learner is simulated, and when a tutor asked several questions at once it answered only the first or the easiest; the judge belongs to the same model family as the tutor; eight topics and three runs make a small sample. Neither split is strong: 15 to 9 is a lean, and 14 to 10 is closer still. The 24 comparisons are eight topics run three times, and the runs of one topic tend to agree. What holds firmly is that both sets of instructions beat no instructions, 24 to 0 at eight messages. The judge isn't perfectly consistent either: reading the same first four messages twice, it changed its giveaway verdict for 6 of the 72 sessions. Length is counted in words, because the notebook didn't record tokens. The harness and transcripts aren't public; readers who want the protocol can ask the author.*

*Disclosure: Skillpack is built by The Vibe Company, the author's company.*

## Your own skill has the same ledger, and you can fill it in

The article on [measuring every change to a Claude skill](/blog/claude-skills-best-practices), published November 13, puts it this way: the problem "isn't whether a skill is too long, it's that people don't measure what each change does to it."

The Socratic Tutor thread is that sentence with a comment section attached. It asked whether 854 words were too many, and the test came back with something to count. The readings suggest the diagnostic pays late and the one-question rule pays. The guard, here, bought nothing measurable.

In its default mode, Microsoft's [SkillOpt](https://github.com/microsoft/SkillOpt) turns that habit into a rule: keep the target model frozen, and accept an edit to a skill only if it improves a score on held-out cases. Ties are rejected. The public [Skill Creator skill](https://github.com/The-Vibe-Company/companion-skills/blob/main/skills/create-skill-tools/SKILL.md) puts the same idea in its default loop: "Build realistic eval prompts, run the skill against a baseline." Once the prompts exist, the next step is [checking agent skills in CI](/blog/how-to-check-agent-skills-in-ci).

So go back to arshxyz's comment, because it's the first half of an experiment: it pulls out the one sentence that seems to do most of the work. Do the same to your own skill. Open the SKILL.md you lean on most and copy out the line you'd bet on. Run the full file, the line and no instructions on the same prompts, graded by something that can't see which is which. Read the results twice, once early and once at the length your real sessions run. Then write down what the file cost and what it bought. To price one section, take it out and run again, the step this test skipped. A section that looks like it buys nothing, like the guard here, is the first one to try deleting. And if your one line wins at your length, ship the one line.

arshxyz did the first half in a comment box. The second half is pressing run.

```cta
title: "Put numbers on your own skill"
text: "Start with the article on measuring every change to a skill, then run your SKILL.md against its best single line."
primary: { label: "Create a free Skillpack workspace", href: /login }
secondary: { label: "Read how to measure every skill change", href: /blog/claude-skills-best-practices }
```

```faq
items:
  - question: "What is Jane Street's Socratic Tutor skill?"
    answer: "Jane Street's Socratic Tutor skill is a single SKILL.md file, published under the MIT license in the janestreet/agent_skills repository on GitHub. Its instructions tell a model to run a diagnostic before teaching, track a skill map with levels 0-5, ask one question at a time, interleave spaced review and finish with a final assessment. When the learner is wrong, the skill tells the model to withhold the answer and ask a narrower question."
  - question: "Can a one-line prompt replace the Socratic Tutor skill?"
    answer: "It depends on how long the session runs. In the notebook test of November 18, 2026, a blind judge gave the one-line prompt a slight edge after four tutor messages, too close to call, and leaned to the full Socratic Tutor skill after eight. The firmer result is that both beat a model with no instructions in every comparison at eight messages. The test used a simulated learner and a small sample, and it measured nothing beyond eight messages."
  - question: "How do you use the Socratic Tutor skill in a plain chatbot?"
    answer: "Jane Street's README says to paste the body of the skill's SKILL.md into the chat, or into a custom or system prompt, followed by what you want it to do. The skill's description lists trigger phrases such as 'teach me', 'tutor me', 'quiz me', 'drill me' and 'help me master'. For a one-off question, the skill's guard section tells the model to answer normally and skip the tutoring loop."
```
