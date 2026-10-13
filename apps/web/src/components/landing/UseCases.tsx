import Link from "next/link";

/* Use cases: one card per common team workflow, each with a short SKILL.md excerpt.
   Static markup with no hooks or state, so every snippet is in the pre-rendered HTML.
   Frontmatter follows https://agentskills.io/specification: the name is lowercase-hyphen
   and matches its folder, and the description says what the skill does and when to use it. */

const REPO_EXAMPLE_URL = "https://github.com/The-Vibe-Company/skillpack/tree/main/examples/skills/incident-summary";
const SKILL_MD_GUIDE_HREF = "/blog/what-is-skill-md";

export type UseCase = {
  title: string;
  desc: string;
  /** Snippet frontmatter `name`; also the folder name shown in the caption. */
  name: string;
  description: string;
  body: string[];
  /** Set only for a skill that exists in this repository, linked as its source. */
  source?: string;
};

export const USE_CASES: UseCase[] = [
  {
    title: "Code review",
    desc: "Write the review checklist down once. Every agent then checks the same things on every pull request, not whatever one reviewer remembers.",
    name: "code-review",
    description:
      "Review a diff against the team checklist for tests, security and naming. Use when asked to review a pull request or local changes.",
    body: ["1. Read the diff and the linked issue.", "2. Post one summary comment, most severe first."],
  },
  {
    title: "Deploy and release",
    desc: "Capture the preflight checks and rollback steps your team already follows, so agents run them in the same order before anything reaches production.",
    name: "deploy",
    description:
      "Deploy the current branch to production with preflight checks and a rollback plan. Use when asked to ship, deploy or release a build.",
    body: ["1. Confirm CI is green and migrations are reviewed.", "2. Deploy, watch error rates, note the rollback."],
  },
  {
    title: "Incident triage",
    desc: "Turn raw logs into a first postmortem draft while the details are fresh. This one is a real example from the Skillpack repository; it works on local files only, with no network access.",
    name: "incident-summary",
    description: "Summarize an incident timeline from logs into a concise postmortem draft.",
    body: [
      "# incident-summary",
      "Reads a directory of log excerpts and produces a terse incident summary: timeline, impact, suspected cause, and follow-ups.",
    ],
    source: REPO_EXAMPLE_URL,
  },
  {
    title: "Release notes",
    desc: "Turn merged pull requests into release notes in your team's format, with the same sections every time.",
    name: "release-notes",
    description:
      "Draft release notes from pull requests merged since the last tag. Use when preparing a release or summarizing what changed between versions.",
    body: ["Group changes under Added, Changed and Fixed.", "Link each line to its pull request."],
  },
  {
    title: "Onboarding",
    desc: "Give new teammates and their agents a guided tour of the codebase: where things live, how to set up, and which conventions matter.",
    name: "repo-onboarding",
    description:
      "Walk a new contributor through this repository's layout, setup commands and conventions. Use when someone asks how to get started or where code lives.",
    body: ["1. Explain each top-level folder in one line.", "2. Run the README setup steps and confirm they pass."],
  },
];

function Snippet({ useCase }: { useCase: UseCase }) {
  return (
    <figure className="lp-case__snippet">
      <figcaption className="lp-case__caption">
        <code>{useCase.name}/SKILL.md</code>
        {useCase.source ? (
          <a href={useCase.source} target="_blank" rel="noreferrer">
            From our repo ↗
          </a>
        ) : (
          <span>Illustrative example</span>
        )}
      </figcaption>
      <pre>
        <code>
          <span className="lp-tok-c">---</span>
          {"\n"}
          <span className="lp-tok-k">name</span>: <span className="lp-tok-s">{useCase.name}</span>
          {"\n"}
          <span className="lp-tok-k">description</span>: {useCase.description}
          {"\n"}
          <span className="lp-tok-c">---</span>
          {"\n"}
          {useCase.body.join("\n")}
        </code>
      </pre>
    </figure>
  );
}

export function UseCases() {
  return (
    <section className="lp-sec" id="use-cases" data-screen-label="use-cases">
      <div className="v10-wrap">
        <p className="lp-kick lp-kick--center">Use cases</p>
        <h2 className="lp-h2 lp-h2--center v5-reveal">
          What teams put in <em className="lp-em">their skills.</em>
        </h2>
        <p className="lp-sub lp-sub--center v5-reveal">
          A skill is a folder with a SKILL.md file: a name, a description that says what it does and when to use it, then
          the instructions. These are common places to start. Most snippets are illustrative; adapt them to how your team
          works.
        </p>
        <div className="lp-cases">
          {USE_CASES.map((u) => (
            <article className="lp-case v5-reveal" key={u.name}>
              <h3>{u.title}</h3>
              <p>{u.desc}</p>
              <Snippet useCase={u} />
            </article>
          ))}
        </div>
        <p className="lp-cases__more v5-reveal">
          <Link href={SKILL_MD_GUIDE_HREF}>Read the SKILL.md guide →</Link>
        </p>
      </div>
    </section>
  );
}
