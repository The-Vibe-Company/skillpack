import Link from "next/link";
import { Icon } from "@/components/Icon";
import { faqPageStructuredData, serializeJsonLd } from "@/lib/structuredData";

/* Home FAQ. The visible answers and the FAQPage JSON-LD both come from HOME_FAQ, so the
   structured data can never claim more than the page shows. Backticks mark inline code;
   every answer must stay verifiable in the repository (see the PR that introduced it). */

export type HomeFaqEntry = {
  question: string;
  answer: string;
  link?: { href: string; label: string };
};

export const HOME_FAQ: readonly HomeFaqEntry[] = [
  {
    question: "What is SKILL.md?",
    answer:
      "SKILL.md is the file that defines an Agent Skill: YAML frontmatter with a `name` and a `description`, followed by Markdown instructions. The skill folder can also bundle scripts, references and templates that the agent loads only when a task needs them.",
    link: { href: "/blog/what-is-skill-md", label: "Read the SKILL.md guide" },
  },
  {
    question: "Is Skillpack open source?",
    answer: "Yes. Skillpack's source code is on GitHub under the MIT License.",
  },
  {
    question: "Can I self-host Skillpack?",
    answer:
      "Yes. Skillpack runs as a Next.js web app, an API, a background worker and a one-shot migration service, backed by PostgreSQL and S3-compatible object storage. The repository includes deployment configs for Railway. If you'd rather not run it yourself, use skillpack.app.",
  },
  {
    question: "Which coding agents does Skillpack support?",
    answer:
      "The `skillpack` CLI installs skills into Claude Code, Codex and OpenCode. Choose targets with `--tools claude-code,codex,opencode`, and run `skillpack setup` to configure those integrations. Agents can also reach the Skills Hub through Agent Auth, a personal access token or Skillpack's MCP server.",
  },
  {
    question: "How are skill versions pinned?",
    answer:
      "Every published version is immutable. `skillpack install code-review --scope project` records the exact version and its sha256 checksum in `.companion/skills.lock.json`. Installing with `--version` or `--pin` pins that version, and `skillpack update` skips pinned skills unless you pass a `--version`. `skillpack sync --frozen` checks each installed copy against its locked checksum, stops on drift and restores missing skills at their locked version.",
  },
  {
    question: "How is Skillpack different from a public skills directory?",
    answer:
      "A public directory lists skills anyone can browse. Skillpack is a private registry for your organization: personal skills stay visible only to their creator, organization skills are shared with every member, and published versions never change. To share outside your organization, you can publish one pinned version as a public release.",
  },
  {
    question: "How does Skillpack handle secrets?",
    answer:
      "Secrets are write-only. Skillpack accepts a secret's value only when you create or rotate it, stores it with envelope encryption and never returns it through ordinary reads. Skills reference secrets by slot, and approved agents get values only through short-lived, non-replayable grants. Logs and audit records never contain secret values.",
  },
  {
    question: "What's the difference between a skill and an MCP server?",
    answer:
      "A skill is a folder of instructions, plus optional scripts and references, that an agent reads when a task matches its description. An MCP server is a running service that exposes tools to an agent over the Model Context Protocol. Skillpack manages skills, and it also runs an MCP server so an agent platform can work with your Skills Hub, acting as the member who approved it inside one workspace.",
  },
];

/** The answer as plain text, as search engines receive it in the FAQPage JSON-LD. */
export function faqAnswerText(answer: string): string {
  return answer.replaceAll("`", "");
}

const HOME_FAQ_STRUCTURED_DATA = faqPageStructuredData(
  HOME_FAQ.map((entry) => ({ question: entry.question, answer: faqAnswerText(entry.answer) })),
);

function FaqAnswer({ answer }: { answer: string }) {
  return (
    <>
      {answer.split("`").map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))}
    </>
  );
}

export function FaqSection() {
  return (
    <section className="lp-sec" id="faq" data-screen-label="faq" aria-labelledby="faq-title">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(HOME_FAQ_STRUCTURED_DATA) }} />
      <div className="v10-wrap">
        <p className="lp-kick lp-kick--center">FAQ</p>
        <h2 className="lp-h2 lp-h2--center v5-reveal" id="faq-title">
          Frequently asked <em className="lp-em">questions</em>
        </h2>
        <div className="lp-faq">
          {HOME_FAQ.map((entry) => (
            <details className="lp-faq__item" key={entry.question}>
              <summary className="lp-faq__q">
                {entry.question}
                <Icon name="chevron-down" size={18} />
              </summary>
              <div className="lp-faq__a">
                <p>
                  <FaqAnswer answer={entry.answer} />
                </p>
                {entry.link && (
                  <p>
                    <Link href={entry.link.href}>{entry.link.label} →</Link>
                  </p>
                )}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
