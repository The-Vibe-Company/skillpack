/* Skillpack marketing landing (v12 "Release label").
   Art direction chosen with AEOM (direction "etiquette"): the page reads top to bottom like the
   sealed label of a shipped package. Each section opens on a numbered field bar, versions and
   checksums are the visual material, and the one seal colour is the signal yellow of the product's
   primary button. Product pictures follow the Stageshow rules (a believable miniature of the real
   UI, real words only where the story is, cropped with intent); the "How it works" tiles sit on a
   ruled bento grid. The page renders on the server; the portal demo (PortalCapture, lazy-loaded)
   and the lazy motion island (LandingMotion -> LandingReveal) are the only client islands. Every word on the page is in the server HTML. */

import Link from "next/link";
import { Fragment } from "react";
import { Icon } from "@/components/Icon";
import { isPublicCatalogEnabled } from "@/lib/publicCatalog";
import { HOME_STRUCTURED_DATA, SKILLPACK_GITHUB_URL, serializeJsonLd } from "@/lib/structuredData";
import { Avatar } from "./Avatar";
import { Comparison } from "./Comparison";
import { FaqSection } from "./FaqSection";
import { LandingMotion } from "./LandingMotion";
import { PortalDemo } from "./PortalDemo";
import { UseCases } from "./UseCases";

const GITHUB_URL = SKILLPACK_GITHUB_URL;
const SKILL_MD_URL = "https://github.com/anthropics/skills";
const VIBE_COMPANY_URL = "https://thevibecompany.co";
const CATALOG_HREF = "/catalog";

/* Commands wrap only between arguments, so flags like --frozen never split at their hyphens. */
function Cmd({ children }: { children: string }) {
  return (
    <code className="hm-cmd">
      {children.split(" ").map((arg, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span>{arg}</span>
        </Fragment>
      ))}
    </code>
  );
}

/* ---------------------------------------------------------------- copy --- */

const COPY = {
  nav: { how: "How it works", agents: "Agents", openSource: "Open source", blog: "Blog", catalog: "Catalog" },
  github: "GitHub",
  navCta: "Get started",
  menu: "Menu",
  heroBadge: "Open source · Self-hostable Skills Hub",
  heroTitlePre: "The ",
  heroTitleOpen: "open-source",
  heroTitleMark: "Skills Hub",
  heroTitlePost: " for Claude Code, Codex & OpenCode",
  heroSub:
    "A private, versioned skills registry for your team. Write and validate SKILL.md packages, share them across your organization, then install an exact version into Claude Code, Codex and OpenCode with one command. Self-host it or use skillpack.app.",
  ctaPrimary: "Start your library",
  ctaSecondary: "See how it works",
  heroInstallLabel: "Install",
  heroCommand: "skillpack install code-review",
  heroRelease: "Immutable release",
  heroFacts: [
    { label: "Format", value: "SKILL.md" },
    { label: "Releases", value: "Immutable, sha256" },
    { label: "Installs into", value: "Claude Code · Codex · OpenCode" },
    { label: "License", value: "MIT, self-hostable" },
  ],
  agentsKick: "For coding agents",
  agentsTitlePre: "Install agent skills in ",
  agentsTitleMark: "Claude Code, Codex and OpenCode",
  agentsLead: (
    <>
      One command installs an exact version into the agents you pick with <Cmd>--tools</Cmd>, and a lockfile records its
      version and sha256.
    </>
  ),
  connectTitle: "Connect Claude Code, Codex and OpenCode securely",
  agentsSub:
    "Agents sign in through Agent Auth, personal access tokens or the Skillpack MCP server. Each connection acts with the consenting member's rights, inside the one workspace chosen at consent.",
  agentsPoints: [
    { icon: "file-code", text: "Read, write and publish skills" },
    { icon: "database", text: "Use tenant-scoped Skill Databases" },
    { icon: "key-round", text: "Retrieve bound secrets through short-lived grants" },
  ],
  agentsNote: "Skillpack never launches your agents or runs skill package scripts.",
  problemKick: "The problem",
  problemTitlePre: "Why teams need a ",
  problemTitleMark: "private skills registry",
  problemSub:
    "One engineer's review checklist lives in a gist. The deploy skill was pasted in Slack. Every agent runs a different copy, and nobody knows which one is current.",
  problemPunch: "Great skills exist. They just don't travel.",
  howKick: "How it works",
  howTitlePre: "How Skillpack versions ",
  howTitleMark: "SKILL.md packages",
  steps: [
    {
      n: "01",
      title: "Create and validate",
      desc: "Write a SKILL.md or upload a package. Skillpack checks the archive, manifest, dependencies and declared secrets before anything ships.",
    },
    {
      n: "02",
      title: "Version and share",
      desc: "Publish immutable versions. Keep a skill in My Skills, or share it with your organization so every member can use and improve it.",
    },
    {
      n: "03",
      title: "Install everywhere",
      desc: (
        <>
          One command installs an exact version into the agents you pick with <Cmd>--tools</Cmd>, and a lockfile records its
          version and sha256. Add <Cmd>--pin</Cmd> to hold a version; <Cmd>skillpack update --all --dry-run</Cmd> previews
          updates, and <Cmd>skillpack sync --frozen</Cmd> verifies locked project packages and restores missing ones.
        </>
      ),
    },
    {
      n: "04",
      title: "See what gets used",
      desc: "Agents can report each activation without signing in, and anyone can opt out. Find the skills that actually earn their place.",
    },
  ],
  trustKick: "Open source",
  trustTitlePre: "Open-source, self-hosted, ",
  trustTitleMark: "private by default",
  trustText:
    "Keep a skill private in My Skills or share it with your organization. Skillpack can run its control plane and skill registry on your own servers, so governance stays on infrastructure you control.",
  trustFacts: [
    { title: "MIT licensed", desc: "Read the code, fork it, run it. No black box." },
    { title: "Private by default", desc: "Personal skills are visible to their creator only, with no admin override." },
    { title: "Write-only secrets", desc: "Envelope-encrypted, referenced by id, never shown again." },
    { title: "Checksummed releases", desc: "Public releases pin exact, immutable versions." },
    { title: "GitHub mirror", desc: "Sync organization skills to a repository you own." },
    { title: "Portable SKILL.md", desc: "An open format your skills can always leave with." },
  ],
  trustRepo: "Read the code on GitHub ↗",
  finaleKick: "Get started",
  finaleTitlePre: "Build a skill once. ",
  finaleTitleMark: "Every agent uses it.",
  finaleSub: "Setup takes an afternoon. Your first shared skill can ship today.",
  finaleSmall: "Open source · MIT · runs on your own infrastructure if you want",
  finaleCta: "Get started",
  footerByPre: "an open source tool by ",
  footerByCompany: "The Vibe Company",
  footerDocs: "Documentation",
  footerBlogTitle: "From the blog",
};

type Copy = typeof COPY;

/* Install targets the CLI supports (`--tools`), in the order the CLI lists them. */
const AGENTS = [
  { name: "Claude Code", tool: "claude-code" },
  { name: "Codex", tool: "codex" },
  { name: "OpenCode", tool: "opencode" },
] as const;

const SHARE_AVATARS = [
  { who: "Marie", tone: "violet" },
  { who: "Jonas", tone: "blue" },
  { who: "Sam", tone: "amber" },
  { who: "Léa", tone: "teal" },
  { who: "Tom", tone: "terracotta" },
];

const SCATTER = [
  { name: "SKILL.md", tag: "copied from Slack" },
  { name: "code-review/", tag: "which version?" },
  { name: "deploy-final-v2.md", tag: "outdated" },
  { name: "triage.md", tag: "API key inside" },
  { name: "release-notes/", tag: "only on one laptop" },
];

/* Posts on main that extend the page's topics; slugs are checked against content/blog in tests. */
export const HOME_BLOG_LINKS = [
  { slug: "what-is-skill-md", title: "What is SKILL.md? The complete guide to Agent Skills" },
  { slug: "claude-skills-examples", title: "Claude skills examples that aren't toy demos" },
  { slug: "claude-code-subagents-vs-skills", title: "Claude Code subagents vs skills: when to use each" },
  { slug: "best-claude-code-skills-planning", title: "Best Claude Code skills for planning and specs" },
  { slug: "how-to-check-agent-skills-in-ci", title: "How to check agent skills in CI: validate, lock, sync" },
] as const;

/* Sections in reading order, for the index rail. */
const INDEX = [
  { href: "#agents", label: "Install" },
  { href: "#problem", label: "The problem" },
  { href: "#how", label: "How it works" },
  { href: "#use-cases", label: "Examples" },
  { href: "#open-source", label: "Open source" },
  { href: "#compare", label: "Compare" },
  { href: "#faq", label: "FAQ" },
  { href: "#start", label: "Get started" },
];

/* ------------------------------------------------------------ utilities --- */

/** The one highlighted idea in each headline: solid ink over a seal-yellow underline. */
function Em({ children }: { children: React.ReactNode }) {
  return <em className="lp-em">{children}</em>;
}

function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg className="lp-mark" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M70,22 H37 A9 9 0 0 0 28,31 V41" stroke="#EA580C" />
      <path d="M28,41 A9 9 0 0 0 37,50 H63 A9 9 0 0 1 72,59" stroke="#F59E0B" />
      <path d="M72,59 V69 A9 9 0 0 1 63,78 H30" stroke="#FBBF24" />
    </svg>
  );
}

/** A decorative barcode band, the label's signature. */
function Barcode({ className }: { className?: string }) {
  return <span className={"hm-barcode" + (className ? " " + className : "")} aria-hidden="true"></span>;
}

/** The numbered field bar that opens every section of the label. */
function Field({ n, label, meta }: { n: string; label: string; meta?: string }) {
  return (
    <div className="hm-field">
      <span className="hm-field__n">{n}</span>
      <span className="hm-field__label">{label}</span>
      {meta && (
        <span className="hm-field__meta" aria-hidden="true">
          {meta}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- sections --- */

function Nav({ c, catalog }: { c: Copy; catalog: boolean }) {
  const links = (
    <>
      <a className="v10-nav__link" href="#how">
        {c.nav.how}
      </a>
      <a className="v10-nav__link" href="#agents">
        {c.nav.agents}
      </a>
      <a className="v10-nav__link" href="#open-source">
        {c.nav.openSource}
      </a>
      <Link className="v10-nav__link" href="/blog">
        {c.nav.blog}
      </Link>
      {catalog && (
        <Link className="v10-nav__link" href={CATALOG_HREF}>
          {c.nav.catalog}
        </Link>
      )}
    </>
  );
  return (
    <header className="v10-nav">
      <div className="v10-wrap v10-nav__inner">
        <a className="v5-brand" href="#top" aria-label="Skillpack, back to top">
          <img className="v10-wordmark" src="/brand/skillpack-wordmark-dark-text.svg" alt="Skillpack" width={520} height={110} />
        </a>
        <nav className="v10-nav__links" aria-label="Sections">
          {links}
        </nav>
        <span className="v10-nav__spacer"></span>
        <div className="v10-nav__actions">
          <a className="v10-btn v10-btn--ghost v10-btn--sm hm-nav-gh" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            {c.github} ↗
          </a>
          <Link href="/login" className="v10-btn v10-btn--primary v10-btn--sm">
            {c.navCta}
          </Link>
          {/* Native disclosure: the phone menu needs no script to open. */}
          <details className="hm-menu">
            <summary className="hm-menu__toggle">
              <span className="hm-menu__bars" aria-hidden="true"></span>
              <span className="hm-menu__label">{c.menu}</span>
            </summary>
            <nav className="hm-menu__panel" aria-label="Menu">
              {links}
              <a className="v10-nav__link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                {c.github} ↗
              </a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

function Hero({ c }: { c: Copy }) {
  return (
    <section className="hm-hero" id="top" data-screen-label="hero" aria-labelledby="hero-title">
      <div className="v10-wrap">
        <div className="hm-hero__label">
          <Field n="00" label={c.heroBadge} />
          <div className="hm-hero__body">
            <div className="hm-hero__copy">
              <h1 className="lp-h1" id="hero-title">
                {c.heroTitlePre}
                <span className="hm-nowrap">{c.heroTitleOpen}</span> <Em>{c.heroTitleMark}</Em>
                {c.heroTitlePost}
              </h1>
              <p className="hm-hero__sub">{c.heroSub}</p>
              <div className="hm-ctas">
                <Link href="/login" className="v10-btn v10-btn--primary v10-btn--lg">
                  {c.ctaPrimary}
                </Link>
                <a className="v10-btn v10-btn--ghost v10-btn--lg" href="#problem">
                  {c.ctaSecondary}
                </a>
              </div>
            </div>
            <div className="hm-facts">
              <dl>
                {c.heroFacts.map((f) => (
                  <div className="hm-facts__row" key={f.label}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="hm-facts__seal" aria-hidden="true">
                <Barcode />
                <code>code-review@1.3.0 · sha256:9f3c…a71e</code>
              </div>
            </div>
          </div>
          <div className="hm-track" role="group" aria-label="Install command">
            <Barcode className="hm-track__code" />
            <div className="hm-track__line">
              <span className="hm-track__label">{c.heroInstallLabel}</span>
              <code className="hm-track__cmd">
                <span className="hm-prompt" aria-hidden="true">
                  ${" "}
                </span>
                {c.heroCommand}
              </code>
            </div>
          </div>
        </div>
        <div className="hm-hero__stage">
          <PortalDemo />
          <div className="hm-release" aria-hidden="true">
            <div className="hm-release__head">
              <span>code-review</span>
              <span>1.3.0</span>
            </div>
            <Barcode className="hm-release__code" />
            <div className="hm-release__foot">
              <span className="hm-seal">{c.heroRelease}</span>
              <code>sha256:9f3c…a71e</code>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AgentsTerminal() {
  return (
    <figure className="hm-term v5-reveal" aria-label="Example terminal session: one install into three agents">
      <div className="hm-term__bar" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <pre className="hm-term__body">
        <code>
          <span className="hm-term__line">
            <span className="hm-prompt">$ </span>skillpack install code-review --tools {AGENTS.map((a) => a.tool).join(",")}
          </span>
          {"\n"}
          {AGENTS.map((a) => (
            <span key={a.tool}>
              <span className="hm-term__line hm-term__ok">
                <span className="hm-term__tick">✓</span> {a.tool.padEnd(12)}code-review@1.3.0
              </span>
              {"\n"}
            </span>
          ))}
          <span className="hm-term__line hm-term__dim">locked .companion/skills.lock.json · sha256</span>
          {"\n\n"}
          <span className="hm-term__line">
            <span className="hm-prompt">$ </span>skillpack sync --frozen
          </span>
          {"\n"}
          <span className="hm-term__line hm-term__ok">
            <span className="hm-term__tick">✓</span> code-review@1.3.0 matches its locked checksum
          </span>
        </code>
      </pre>
    </figure>
  );
}

function Agents({ c }: { c: Copy }) {
  return (
    <section className="hm-sec" id="agents" data-screen-label="agents">
      <Field n="01" label={c.agentsKick} meta="--tools" />
      <div className="hm-sec__body">
        <div className="hm-agents" data-screen-label="agents-strip">
          <h2 className="lp-h2 v5-reveal">
            {c.agentsTitlePre}
            <Em>{c.agentsTitleMark}</Em>
          </h2>
          <p className="lp-sub v5-reveal">{c.agentsLead}</p>
          <ul className="hm-ports" aria-label="Supported install targets">
            {AGENTS.map((a) => (
              <li className="lp-agent hm-port" key={a.name}>
                <span className="hm-port__led" aria-hidden="true"></span>
                <code className="hm-port__tool">{a.tool}</code>
                <span className="hm-port__name">{a.name}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="hm-split">
          <AgentsTerminal />
          <div className="hm-connect">
            <h3 className="hm-h3">{c.connectTitle}</h3>
            <p className="hm-body">{c.agentsSub}</p>
            <ul className="hm-points">
              {c.agentsPoints.map((p) => (
                <li key={p.text}>
                  <Icon name={p.icon} size={16} />
                  {p.text}
                </li>
              ))}
            </ul>
            <p className="lp-note">{c.agentsNote}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Problem({ c }: { c: Copy }) {
  return (
    <section className="hm-sec" id="problem" data-screen-label="the-problem">
      <Field n="02" label={c.problemKick} meta="5 copies · 0 versions" />
      <div className="hm-sec__body hm-split hm-split--problem">
        <div>
          <h2 className="lp-h2 v5-reveal">
            {c.problemTitlePre}
            <Em>{c.problemTitleMark}</Em>
          </h2>
          <p className="lp-sub v5-reveal">{c.problemSub}</p>
          <p className="lp-punch v5-reveal">{c.problemPunch}</p>
        </div>
        <ul className="hm-returns v5-reveal" aria-hidden="true">
          {SCATTER.map((f) => (
            <li className="hm-returns__row" key={f.name}>
              <Icon name="file-text" size={14} />
              <code>{f.name}</code>
              <span className="hm-returns__tag">
                <Icon name="alert-triangle" size={12} />
                {f.tag}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function StepVisual({ n }: { n: string }) {
  if (n === "01") {
    return (
      <div className="hm-vis hm-vis--validate" aria-hidden="true">
        <pre className="hm-vis__code">
          <span className="lp-tok-c">---</span>
          {"\n"}
          <span className="lp-tok-k">name</span>: <span className="lp-tok-s">code-review</span>
          {"\n"}
          <span className="lp-tok-k">version</span>: <span className="lp-tok-n">1.3.0</span>
          {"\n"}
          <span className="lp-tok-c">---</span>
        </pre>
        <ul className="hm-checks">
          {["SKILL.md is valid", "Archive is safe", "Dependencies resolved", "Secrets encrypted"].map((t) => (
            <li key={t}>
              <Icon name="circle-check" size={14} /> {t}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (n === "02") {
    return (
      <div className="hm-vis hm-vis--share" aria-hidden="true">
        <div className="hm-lib">
          <span className="hm-lib__label">
            <Icon name="lock" size={12} /> My Skills
          </span>
          <span className="hm-chip">code-review</span>
        </div>
        <span className="hm-share-arrow">
          <Icon name="arrow-right" size={16} />
        </span>
        <div className="hm-lib hm-lib--org">
          <span className="hm-lib__label">
            <Icon name="users" size={12} /> Organization
          </span>
          <span className="hm-chip hm-chip--on">
            code-review <code>v1.3.0</code>
          </span>
          <span className="hm-versions">
            <code>v1.2.0</code>
            <code>v1.1.0</code>
            <span>immutable</span>
          </span>
          <span className="hm-avatars">
            {SHARE_AVATARS.map((m) => (
              <Avatar who={m.who} tone={m.tone} sm key={m.who} />
            ))}
          </span>
        </div>
      </div>
    );
  }
  if (n === "03") {
    return (
      <div className="hm-vis hm-vis--lock" aria-hidden="true">
        <div className="hm-vis__file">.companion/skills.lock.json · excerpt</div>
        <pre className="hm-vis__code">
          <span className="lp-tok-k">&quot;code-review&quot;</span>: {"{"}
          {"\n  "}
          <span className="lp-tok-k">&quot;version&quot;</span>: <span className="lp-tok-s">&quot;1.3.0&quot;</span>,{"\n  "}
          <span className="lp-tok-k">&quot;checksum&quot;</span>: <span className="lp-tok-s">&quot;sha256:9f3c…a71e&quot;</span>,{"\n  "}
          <span className="lp-tok-k">&quot;pinned&quot;</span>: <span className="lp-tok-n">null</span>,{"\n  "}
          <span className="lp-tok-k">&quot;targets&quot;</span>: [{"{ "}
          <span className="lp-tok-k">&quot;tool&quot;</span>: <span className="lp-tok-s">&quot;codex&quot;</span>, …{" }"}, …]
          {"\n}"}
        </pre>
      </div>
    );
  }
  const bars = [30, 36, 33, 44, 41, 52, 48, 60, 56, 68, 64, 78, 74, 92];
  return (
    <div className="hm-vis hm-vis--usage" aria-hidden="true">
      <div className="hm-bars">
        {bars.map((b, i) => (
          <span key={i} style={{ height: `${b}%` }} className={i === bars.length - 1 ? "hm-bar hm-bar--now" : "hm-bar"} />
        ))}
      </div>
    </div>
  );
}

function How({ c }: { c: Copy }) {
  return (
    <section className="hm-sec" id="how" data-screen-label="how-it-works">
      <Field n="03" label={c.howKick} meta="01 → 04" />
      <div className="hm-sec__body">
        <h2 className="lp-h2 v5-reveal">
          {c.howTitlePre}
          <Em>{c.howTitleMark}</Em>
        </h2>
        <ol className="hm-bento">
          {c.steps.map((s) => (
            <li className={"lp-step hm-tile hm-tile--" + s.n + " v5-reveal"} key={s.n}>
              <div className="hm-tile__text">
                <span className="hm-tile__n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
              <StepVisual n={s.n} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Trust({ c }: { c: Copy }) {
  return (
    <section className="hm-sec" id="open-source" data-screen-label="trust">
      <Field n="05" label={c.trustKick} meta="MIT" />
      <div className="hm-sec__body">
        <h2 className="lp-h2 v5-reveal">
          {c.trustTitlePre}
          <Em>{c.trustTitleMark}</Em>
        </h2>
        <p className="lp-sub v5-reveal">{c.trustText}</p>
        <dl className="hm-spec v5-reveal">
          {c.trustFacts.map((f) => (
            <div className="lp-fact hm-spec__row" key={f.title}>
              <dt>{f.title}</dt>
              <dd>{f.desc}</dd>
            </div>
          ))}
        </dl>
        <p className="hm-repo">
          <Barcode className="hm-repo__code" />
          <code>github.com/The-Vibe-Company/skillpack</code>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            {c.trustRepo}
          </a>
        </p>
      </div>
    </section>
  );
}

function Finale({ c }: { c: Copy }) {
  return (
    <section className="hm-sec hm-finale" id="start" data-screen-label="finale">
      <Field n="08" label={c.finaleKick} />
      <div className="hm-sec__body hm-finale__body">
        <Mark size={48} />
        <h2 className="lp-h2">
          {c.finaleTitlePre}
          <Em>{c.finaleTitleMark}</Em>
        </h2>
        <p className="lp-sub">{c.finaleSub}</p>
        <div className="hm-ctas">
          <Link href="/login" className="v10-btn v10-btn--primary v10-btn--lg">
            {c.finaleCta}
          </Link>
          <a className="v10-btn v10-btn--ghost v10-btn--lg" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            {c.github} ↗
          </a>
        </div>
        <p className="hm-finale__small">{c.finaleSmall}</p>
      </div>
    </section>
  );
}

/** The label's index: a numbered field block at the head of the sheet, one link per section. */
function IndexStrip() {
  return (
    <nav className="hm-index" aria-label="On this page">
      <span className="hm-index__title">Index</span>
      <ol className="hm-index__list">
        {INDEX.map((item, i) => (
          <li key={item.href}>
            <a href={item.href}>
              <span className="hm-index__n">{String(i + 1).padStart(2, "0")}</span>
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Footer({ c, catalog }: { c: Copy; catalog: boolean }) {
  return (
    <footer className="v10-footer hm-footer">
      <div className="v10-wrap">
        <nav className="hm-footer__blog" aria-labelledby="footer-blog-title">
          <p className="hm-footer__title" id="footer-blog-title">
            {c.footerBlogTitle}
          </p>
          <ul>
            {HOME_BLOG_LINKS.map((post) => (
              <li key={post.slug}>
                <a href={`/blog/${post.slug}`}>{post.title}</a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="v10-wrap v10-footer__inner">
        <span className="v5-brand">
          <img className="v10-wordmark v10-wordmark--sm" src="/brand/skillpack-wordmark-dark-text.svg" alt="Skillpack" width={520} height={110} />
        </span>
        <span className="v10-footer__by">
          {c.footerByPre}
          <a href={VIBE_COMPANY_URL} target="_blank" rel="noreferrer">
            {c.footerByCompany}
          </a>
        </span>
        <span className="v10-footer__links">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
          <a href={SKILL_MD_URL} target="_blank" rel="noreferrer">
            SKILL.md ↗
          </a>
          <Link href="/blog">Blog</Link>
          {catalog && <Link href={CATALOG_HREF}>Catalog</Link>}
          <Link href="/privacy">Privacy</Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            {c.footerDocs} ↗
          </a>
        </span>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ app --- */

export function LandingPage() {
  const c = COPY;
  // The catalog route 404s while its flag is off; link to it only when it can answer, as the sitemap does.
  const catalog = isPublicCatalogEnabled();

  return (
    <div className="v10-landing lp lp-label lp-home">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(HOME_STRUCTURED_DATA) }} />
      <a className="v10-skip" href="#main-content">
        Skip to content
      </a>
      <Nav c={c} catalog={catalog} />
      <main id="main-content" className="hm-main">
        <Hero c={c} />
        <IndexStrip />
        <Agents c={c} />
        <Problem c={c} />
        <How c={c} />
        <UseCases />
        <Trust c={c} />
        <Comparison />
        <FaqSection />
        <Finale c={c} />
      </main>
      <Footer c={c} catalog={catalog} />
      <LandingMotion />
    </div>
  );
}
