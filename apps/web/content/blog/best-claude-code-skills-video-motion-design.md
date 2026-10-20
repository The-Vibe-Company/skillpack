---
title: "Best Claude Code Skills for Video and Motion Design (2026)"
description: "Eight Claude Code skills for video and motion design in 2026, ranked by skills.sh installs: HyperFrames, Remotion, GSAP, LottieFiles and more."
slug: best-claude-code-skills-video-motion-design
date: 2026-10-20
tags: ["Claude Code", "Agent Skills", "Video", "Motion Design"]
author: "Stan Girard"
authorRole: "co-founder of The Vibe Company, which builds Skillpack"
layout: ranking
dataCollected: 2026-10-20
---

# Best Claude Code Skills for Video and Motion Design in 2026

The most-installed Claude Code skill for video is HeyGen's **hyperframes**, with 1.08M installs on skills.sh. It turns a brief, a URL or a pull request into a video written in HTML. Remotion's official skill comes second for React-based video. The other six cover the motion side: reviewing UI animations, React view transitions, GSAP, app walkthroughs from Google Stitch, animation performance and LottieFiles' motion principles. Each entry has a one-line command to install it and share it with your team.

```cta
title: "Install any skill on this page with one command, and share it with your team."
text: "`skillpack install github:heygen-com/hyperframes/skills/hyperframes` works without an account. Create a free Skillpack workspace to share skills across your organization."
primary: { label: "Create a free Skillpack workspace", href: /login }
```

```takeaways
title: Key Takeaways
items:
  - lead: "Pick one video engine first."
    text: "HyperFrames renders HTML, Remotion renders React. Both have an official skill, and they overlap, so most projects need only one of them."
  - lead: "Motion skills split into two jobs."
    text: "Some teach the agent how to animate (gsap-core, vercel-react-view-transitions, motion-design). Others review what it built (review-animations, fixing-motion-performance)."
  - lead: "Check the framework license, not only the skill's."
    text: "Remotion is free for individuals and companies of up to 3 employees. Larger for-profit companies need a company license, whichever skill writes the code."
  - lead: "Some skills need outside tools."
    text: "hyperframes leans on the HyperFrames CLI. Google's Stitch skill needs the Stitch MCP server. Read each card's limits before you install."
  - lead: "A shared motion skill only helps if everyone runs the same version."
    text: "Pin the exact commit in a lockfile that lives in the repo."
```

## What video and motion design skills actually do

A Claude Code skill is a folder with a `SKILL.md` file. It holds instructions, and sometimes scripts or reference files, that the agent loads when a task matches the skill's description ([what is SKILL.md](/blog/what-is-skill-md)).

Agents can already write animation code. What they lack is taste and process. Left alone, they pick weak easing curves, animate layout properties that drop frames, and render a video before you've seen a preview. The skills below fix that in two ways.

**Video skills** give the agent a production process. They decide which framework writes the video, when to show a preview, and when to render the final file. HyperFrames writes each video as an HTML page. Remotion writes it as React components. Both render the result to MP4.

**Motion skills** give the agent rules for animation itself: durations, easing, choreography, accessibility and performance. They work on product UI as much as on video.

None of them is an MCP server. A skill gives the agent know-how. An MCP server gives it access to a system ([Agent Skills vs MCP](/blog/agent-skills-vs-mcp)). Google's Stitch skill is the one entry here that expects an MCP server to be running.

## How we ranked these skills

We looked at the most-installed skills on skills.sh whose main job is making video or designing motion, kept one skill per repository, and used four public criteria. All numbers were collected on October 20, 2026.

1. **Adoption**: all-time installs reported on [skills.sh](https://skills.sh), the open leaderboard for Agent Skills.
2. **Maintainer**: who maintains the skill, and the GitHub stars of its repository. Stars count the whole repository, not the individual skill.
3. **License clarity**: whether the skill or its repository declares an open-source license.
4. **Scope fit**: whether the skill produces video, teaches animation, or reviews it.

Adoption sets the order. The other criteria are shown for every skill so you can weigh them yourself. We left out generative AI video skills that only wrap a paid model API, since they don't help the agent design motion. Skillpack isn't ranked. The Vibe Company, the author's company, builds Skillpack, the open-source tool used here to install and share skills, and it only appears in the install commands.

## The best Claude Code skills for video and motion design in 2026

Install counts change every day, so treat this as a snapshot from October 20, 2026. Each command below points at the skill's real folder on GitHub. Add `--scope project` to install it in the current repo for Claude Code, Codex and OpenCode, and `--share-org` to publish a copy to your Skillpack organization.

```skill-card
rank: 1
name: hyperframes
maintainer: "HeyGen"
bestFor: "turning a brief, a URL or a PR into a finished video"
source: { label: heygen-com/hyperframes, url: "https://github.com/heygen-com/hyperframes/tree/main/skills/hyperframes" }
repoStars: "67.9K"
installs:
  count: "1.08M"
  url: "https://skills.sh/heygen-com/hyperframes/hyperframes"
license:
  name: "Apache 2.0"
  note: "repository LICENSE"
focus: "HTML-to-video entry point"
install: "skillpack install github:heygen-com/hyperframes/skills/hyperframes --scope project"
description: |
  HyperFrames is HeyGen's open-source framework for rendering video from HTML. A composition is an HTML file whose elements declare their timing with `data-*` attributes, and the CLI renders it to video. This skill is the front door. Its own description calls it the "mandatory entry point" for any request to make, edit, animate or render a video.

  It works as a router. For a new video, it first runs a short intent interview and writes a `BRIEF.md`. It then picks one of ten workflows: product launch video, faceless explainer, PR-to-video, short motion graphic, slideshow, captions on existing footage, talking-head overlays, music-driven video, a Remotion port, or a general custom video. For an existing project, it skips the interview and does only what you asked, whether that's an edit, a check or a render.

  The trade-off is that it depends on the HyperFrames CLI. The skill installs each workflow with `npx hyperframes skills update <workflow>` instead of shipping it in the folder. Those workflow skills come from the HyperFrames CLI, so your Skillpack lockfile doesn't track them. The folder also ships five Node scripts, which the Skillpack CLI lists as executables before it copies anything.
suitedFor: |
  marketers and developers who want finished videos from a prompt, a website or a pull request, and are happy to work in HTML and CSS. Teams already deep in React may prefer Remotion.
```

```skill-card
rank: 2
name: remotion-best-practices
maintainer: "Remotion"
bestFor: "building and editing videos in React"
source: { label: remotion-dev/skills, url: "https://github.com/remotion-dev/skills/tree/main/skills/remotion-best-practices" }
repoStars: "5.4K"
installs:
  count: "646.2K"
  url: "https://skills.sh/remotion-dev/skills/remotion-best-practices"
license:
  name: "None declared"
  note: "no license in the skill or the repository; Remotion itself uses its own free/company license"
  declared: false
focus: "Official Remotion router"
install: "skillpack install github:remotion-dev/skills/skills/remotion-best-practices --scope project"
description: |
  Remotion is the React framework for making videos in code, and this is its team's official skill. It describes itself as the "Router for all Remotion skills". The folder bundles eleven guides: creating a project, writing Remotion markup, captions, maps, multimedia, interactivity, Studio, rendering, SaaS apps, docs lookup and upgrades. The agent reads only the guide the task needs.

  Two habits stand out. The agent won't render by default. When you ask it to "make" a video, it starts Remotion Studio and opens the preview as soon as the project runs. You can watch and steer while it builds. It renders only when you clearly ask for the MP4. It's also told to keep any edit you made outside the conversation, and to ask before overwriting one.

  The repository doesn't declare a license, so check before you fork the skill itself. Remotion, the framework, is free for individuals, non-profits and for-profit companies with up to 3 employees. Bigger companies need a company license. The folder includes four small map-preparation scripts.
suitedFor: |
  React developers who want programmatic, editable video, from social clips to rendering pipelines. Check the license if your company has more than 3 employees.
```

```skill-card
rank: 3
name: review-animations
maintainer: "Emil Kowalski"
bestFor: "a strict review of UI animation code"
source: { label: emilkowalski/skills, url: "https://github.com/emilkowalski/skills/tree/main/skills/review-animations" }
repoStars: "47.8K"
installs:
  count: "238.3K"
  url: "https://skills.sh/emilkowalski/skills/review-animations"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Animation review"
install: "skillpack install github:emilkowalski/skills/skills/review-animations --scope project"
description: |
  review-animations reviews animation and motion code against the ideas Emil Kowalski teaches on animations.dev. Its stance is in the description: "Default to flagging; approval is earned." It reviews motion code only and declines anything else.

  Every animation in the diff is checked against ten standards. A few examples: `ease-in` on UI is blocked, UI animations stay under 300ms unless there's a reason, nothing scales from `scale(0)`, only `transform` and `opacity` are animated, and `prefers-reduced-motion` is honored. Frequency matters too. An action used 100 times a day, or one triggered from the keyboard, gets no animation at all.

  The output is fixed: a Before / After / Why table, then a verdict grouped by impact that ends in Block or Approve. A `STANDARDS.md` file holds the exact curves and durations it cites. One detail to know: it sets `disable-model-invocation: true`, so Claude never runs it on its own. You call it with `/review-animations`.
suitedFor: |
  product teams who ship UI motion and want a tough second opinion before merging. Pair it with a skill that writes the motion, since this one only reviews.
```

```skill-card
rank: 4
name: vercel-react-view-transitions
maintainer: "Vercel"
bestFor: "page and state transitions in React and Next.js"
source: { label: vercel-labs/agent-skills, url: "https://github.com/vercel-labs/agent-skills/tree/main/skills/react-view-transitions" }
repoStars: "32.7K"
installs:
  count: "158.8K"
  url: "https://skills.sh/vercel-labs/agent-skills/vercel-react-view-transitions"
license:
  name: "MIT"
  note: "declared in SKILL.md"
focus: "React View Transitions"
install: "skillpack install github:vercel-labs/agent-skills/skills/react-view-transitions --scope project"
description: |
  This skill teaches the agent React's `<ViewTransition>` component, which animates between UI states with the browser's native View Transition API and no animation library. It lives in the `react-view-transitions` folder but is named `vercel-react-view-transitions` in its SKILL.md.

  Its rule is that every transition must express a relationship. It ranks five patterns in the order to implement them: shared elements, Suspense reveals, list reordering, enter and exit, then route changes. Directional slides are reserved for hierarchical navigation, like list to detail, and for ordered sequences. When you add transitions to an existing app, the agent starts with an audit and then follows the step-by-step guide in `references/implementation.md`.

  The setup notes save time. In Next.js, the App Router already bundles the React canary build that has `ViewTransition`, so you shouldn't install `react@canary` yourself. Outside Next.js you need the canary build, since the component isn't in stable React. The skill lists browser support as Chromium 125+, Firefox 144+ and Safari 18.2+, and other browsers skip the animation.
suitedFor: |
  React and Next.js teams who want native page transitions without adding a dependency. Not the right tool for video or for timeline-heavy animation.
```

```skill-card
rank: 5
name: gsap-core
maintainer: "GreenSock"
bestFor: "correct GSAP tweens, easing and staggers"
source: { label: greensock/gsap-skills, url: "https://github.com/greensock/gsap-skills/tree/main/skills/gsap-core" }
repoStars: "16.7K"
installs:
  count: "71.0K"
  url: "https://skills.sh/greensock/gsap-skills/gsap-core"
license:
  name: "MIT"
  note: "declared in SKILL.md and in the repository"
focus: "Official GSAP core API"
install: "skillpack install github:greensock/gsap-skills/skills/gsap-core --scope project"
description: |
  gsap-core is GreenSock's official skill for the GSAP core engine: `gsap.to()`, `from()`, `fromTo()` and `set()`, easing, staggers and defaults. It's one of eight GSAP skills in the repository. Timelines, ScrollTrigger, React, plugins, utilities, performance and other frameworks each have their own.

  It fixes the details agents often get wrong. It prefers GSAP's transform aliases (`x`, `rotation`, `scale`) over raw transform strings and uses `autoAlpha` instead of `opacity` for fades. It also explains when to set `immediateRender: false` so stacked `from()` tweens don't cancel each other. Its section on `gsap.matchMedia()` covers responsive breakpoints and `prefers-reduced-motion`, with animations reverted automatically when a query stops matching.

  Keep in mind that it's a vendor skill. When you ask for animation without naming a library, it tells the agent to recommend GSAP. If your project uses another library, the skill says to respect that choice.
suitedFor: |
  anyone animating DOM or SVG with GSAP, including HyperFrames compositions, which can use GSAP for animation. Add gsap-timeline or gsap-scrolltrigger from the same repository for sequences and scroll effects.
```

```skill-card
rank: 6
name: remotion
title: "remotion (Google Labs Stitch)"
maintainer: "Google Labs"
bestFor: "walkthrough videos of Stitch app designs"
source: { label: google-labs-code/stitch-skills, url: "https://github.com/google-labs-code/stitch-skills/tree/main/plugins/stitch-build/skills/remotion" }
repoStars: "8.5K"
installs:
  count: "41.0K"
  url: "https://skills.sh/google-labs-code/stitch-skills/remotion"
license:
  name: "Apache 2.0"
  note: "repository LICENSE"
focus: "Design-to-video walkthrough"
install: "skillpack install github:google-labs-code/stitch-skills/plugins/stitch-build/skills/remotion --scope project"
description: |
  This skill comes from Google Labs' Stitch skills, a set built around Stitch, Google's AI design tool. It does one specific job: it turns the screens of a Stitch project into a walkthrough video with Remotion, using transitions, zooms and text overlays.

  The workflow is concrete. The agent finds the Stitch and Remotion MCP servers and lists your Stitch projects and screens. It downloads each screenshot with its size and title, and sets up a Remotion project if there isn't one. It then builds a `ScreenSlide` component and a `WalkthroughComposition` that sequences the screens with `@remotion/transitions`, at 30 fps by default.

  It has the most prerequisites on this list: access to the Stitch MCP server, the Remotion MCP server or CLI, Node.js, and a Stitch project with designed screens. Its frontmatter pre-approves tools, including Bash, through `allowed-tools`, so review it before adding it to a shared repo. Since it writes Remotion code, Remotion's license applies to the result.
suitedFor: |
  teams that design in Stitch and want a quick product walkthrough or demo video from those screens. Without Stitch, the general Remotion skill above is the better choice.
```

```skill-card
rank: 7
name: fixing-motion-performance
maintainer: "Julien Thibeaut (ibelick)"
bestFor: "finding and fixing janky animations"
source: { label: ibelick/ui-skills, url: "https://github.com/ibelick/ui-skills/tree/main/skills/fixing-motion-performance" }
repoStars: "9.9K"
installs:
  count: "25.7K"
  url: "https://skills.sh/ibelick/ui-skills/fixing-motion-performance"
license:
  name: "MIT"
  note: "repository LICENSE"
focus: "Animation performance"
install: "skillpack install github:ibelick/ui-skills/skills/fixing-motion-performance --scope project"
description: |
  fixing-motion-performance is a rulebook for animations that stutter. Call `/fixing-motion-performance` to apply its rules to the rest of the conversation, or `/fixing-motion-performance <file>` to get a report. For each violation, the report quotes the line, says why it matters in one sentence and gives a code-level fix.

  The rules come in nine categories, ranked by impact. The "never" patterns come first: reading and writing layout in the same frame, driving animation from scroll events, `requestAnimationFrame` loops with no stop condition, and mixing animation systems that each measure the layout. Then come rules on measurement, scroll, paint, layers, blur (keep it at 8px or less and never continuous) and view transitions.

  It's careful about scope. It tells the agent not to switch animation libraries unless you ask, and to work within your current stack. It doesn't design motion. It makes the motion you have run smoothly.
suitedFor: |
  front-end developers whose transitions drop frames, or who want a performance pass before shipping. It works next to any animation library on this list.
```

```skill-card
rank: 8
name: motion-design
maintainer: "LottieFiles"
bestFor: "timing, easing and choreography rules for any animation"
source: { label: LottieFiles/motion-design-skill, url: "https://github.com/lottiefiles/motion-design-skill/tree/main/skills/motion-design" }
repoStars: "2.4K"
installs:
  count: "18.3K"
  url: "https://skills.sh/lottiefiles/motion-design-skill/motion-design"
license:
  name: "MIT"
  note: "declared in SKILL.md and in the repository"
focus: "Motion principles"
install: "skillpack install github:lottiefiles/motion-design-skill/skills/motion-design --scope project"
description: |
  motion-design is LottieFiles' general motion design skill. Despite the publisher, it doesn't generate Lottie files. It teaches the principles behind good motion and says it works with CSS, Framer Motion, GSAP, Lottie, springs or any other system.

  Before any technical choice, it asks three questions: what the viewer should feel, what the micro-story is, and how to make the motion believable. It then has the agent pick one of four "motion personalities" for the whole project. Each one has its own durations: Playful (150 to 300ms), Premium (350 to 600ms), Corporate (200 to 400ms) and Energetic (100 to 250ms). It also has duration tables per element, easing rules (decelerate in, accelerate out) and Disney animation principles adapted for UI.

  Its choreography rules are the most useful part. Nothing travels more than a third of the screen without a keyframe change, and with three or more elements, no more than a third of them move at once. It's a principles skill, so it pairs well with a skill that knows your library.
suitedFor: |
  designers and developers who want consistent, intentional motion across a product or brand, whatever tool renders it.
```

A few skills just missed the list. Diffusion Studio's [text-to-lottie](https://skills.sh/diffusionstudio/lottie/text-to-lottie) (10.4K installs) writes Lottie JSON, but it expects its own repository's player project. Kyle Zantos' [design-motion-principles](https://skills.sh/kylezantos/design-motion-principles/design-motion-principles) (12.2K) audits UI motion through three designers' approaches. Digital Samba's [ffmpeg](https://skills.sh/digitalsamba/claude-code-video-toolkit/ffmpeg) (11.1K) covers converting, resizing and compressing video assets.

## Side-by-side comparison

Ranked by adoption, with maintainer, license and scope shown for each skill. Data from skills.sh and GitHub, collected October 20, 2026. Stars are for each skill's whole GitHub repository.

```skill-comparison
```

```cta
title: "Settled on a motion stack for the whole team?"
text: "Put your video and motion skills in one Skillpack workspace and pin them to an exact commit in `.companion/skills.lock.json`, so every designer, developer and agent works from the same rules."
primary: { label: "Start free", href: /login }
secondary: { label: "How to share Claude Code skills with your team", href: /blog/how-to-share-claude-code-skills-with-your-team }
```

## Which video or motion skill fits your use case

```use-cases
rows:
  - useCase: "Launch videos and explainers from a URL or brief"
    start: "hyperframes"
    add: "gsap-core"
    why: "A full video workflow, with correct GSAP animation inside the compositions"
  - useCase: "Video in a React codebase"
    start: "remotion-best-practices"
    add: "motion-design"
    why: "Official Remotion guidance, plus timing and easing rules"
  - useCase: "Product walkthrough from app designs"
    start: "remotion (Google Labs Stitch)"
    add: "remotion-best-practices"
    why: "Stitch screens into a video, with Remotion's own guidance for edits"
  - useCase: "Page transitions in Next.js"
    start: "vercel-react-view-transitions"
    add: "fixing-motion-performance"
    why: "Native transitions that stay smooth"
  - useCase: "Reviewing UI motion before merge"
    start: "review-animations"
    add: "fixing-motion-performance"
    why: "A strict craft review, plus a performance pass"
  - useCase: "A consistent motion language for a brand"
    start: "motion-design"
    add: "review-animations"
    why: "One personality and duration palette, checked on every diff"
```

## How to install and share these skills with your team

Each command above installs a public GitHub folder with the Skillpack CLI, without an account. The CLI resolves the branch or tag to an exact commit, shows you the source and any executable files, and asks before copying anything. It never runs package scripts. With `--scope project`, the skill lands in `.agents/skills/`, which OpenCode reads, with managed copies in `.claude/skills/` for Claude Code and `.codex/skills/` for Codex. The exact commit is recorded in `.companion/skills.lock.json`. Commit that lockfile, and `skillpack sync --frozen` gives every teammate and every CI run the same files ([full install guide](/blog/how-to-install-skills-in-claude-code)).

Large repositories work too. Since version 0.3.5, the CLI streams the GitHub archive and keeps only the files in the folder you name, so it can install one skill from a repository as big as heygen-com/hyperframes.

Version drift shows up fast in motion work. If one developer's agent uses last month's review rules and another uses today's, you get two animation styles in the same product.

A skill can also be installed by hand: copy its folder into `.claude/skills/` in your repository, and Claude Code picks it up. Nothing records which commit you copied, though, so keeping teammates on the same version is up to you.

To share a skill with your organization, add `--share-org`. Once the CLI is signed in to your Skillpack workspace, it publishes a copy there and keeps the license and GitHub provenance. It refuses to overwrite an organization skill that already has the same name:

```bash
skillpack install github:heygen-com/hyperframes/skills/hyperframes --scope project --share-org
```

Skillpack is open source (MIT) and can run on your own infrastructure. For other use cases, see our rankings for [frontend design](/blog/best-claude-code-skills-frontend-design) and [code review](/blog/best-claude-code-skills-code-review), or [write your own skill](/blog/how-to-create-a-claude-code-skill).

## FAQ

```faq
items:
  - question: "What is the best Claude Code skill for video?"
    answer: "By installs on skills.sh, it's HeyGen's hyperframes, with 1.08M installs on October 20, 2026. It's Apache 2.0 and renders video from HTML. Remotion's official skill, remotion-best-practices, is second with 646.2K installs and suits React projects."
  - question: "Should I use HyperFrames or Remotion with Claude Code?"
    answer: "Pick HyperFrames if you want the agent to write videos in HTML and CSS, and Remotion if your team works in React. Remotion requires a company license for for-profit companies with more than 3 employees. HyperFrames is Apache 2.0."
  - question: "How do I install a video skill in Claude Code?"
    answer: "Run `skillpack install github:owner/repo/path`, for example `skillpack install github:heygen-com/hyperframes/skills/hyperframes`. Add `--scope project` to install it in the current repository. You can also copy the skill's folder into `.claude/skills/` by hand."
  - question: "Can Claude Code make motion graphics?"
    answer: "Yes. It writes the animation as code (HTML with GSAP or CSS for HyperFrames, React for Remotion) and the framework renders it to MP4. Skills such as hyperframes and remotion-best-practices give it the workflow, and motion skills give it timing and easing rules."
  - question: "Which skill reviews UI animations?"
    answer: "review-animations by Emil Kowalski reviews motion code against ten standards and ends with Block or Approve. You call it with `/review-animations`. For dropped frames, fixing-motion-performance reports each violation with a fix."
  - question: "What licenses do these skills use?"
    answer: "Five declare MIT and two declare Apache 2.0 (hyperframes and Google's Stitch remotion skill). remotion-best-practices declares no license, and Remotion itself uses its own free and company license."
  - question: "How do I keep the same motion skills across my team?"
    answer: "Pin them to an exact commit in a lockfile committed to the repo, and share them through one workspace. See [how to share Claude Code skills with your team](/blog/how-to-share-claude-code-skills-with-your-team)."
```

## Try Skillpack for free

Once you've picked your video engine and motion rules, the next step is making sure everyone uses the same ones. Skillpack installs any public skill from GitHub with one command and pins the exact commit in a lockfile you can commit. It shares skills with your whole organization, with license and source kept. It's open source. [Create your free Skillpack workspace](/login) and share your first skill in a few minutes.

```cta
title: "Your team's skills, in one place."
primary: { label: "Sign up free for Skillpack", href: /login }
sticky: true
```
