"use client";

/* Skillpack marketing landing (v11 "Agents, light").
   Tells the launch-video story on a light surface: one skill is created,
   shared with the organization, installed into every coding agent, and its
   activations are measured. Display type is Inter Tight; highlighted phrases
   use the brand-mark gradient. The portal demo
   mirrors the real Skills list but is presentational, not API-wired. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/cds";
import { Icon } from "@/components/Icon";

const GITHUB_URL = "https://github.com/The-Vibe-Company/skillpack";
const SKILL_MD_URL = "https://github.com/anthropics/skills";
const VIBE_COMPANY_URL = "https://thevibecompany.co";

/* ---------------------------------------------------------------- copy --- */

type PortalSkillId = "code-review" | "deploy" | "triage" | "release-notes" | "migrate-db" | "incident-notes";

const COPY = {
  nav: { how: "How it works", agents: "Agents", openSource: "Open source" },
  github: "GitHub",
  navCta: "Get started",
  heroBadge: "Open source · Self-hostable Skills Hub",
  heroTitlePre: "Your AI agents are only as good as their ",
  heroTitleMark: "skills.",
  heroSub:
    "Skillpack is where your team writes, versions and shares SKILL.md packages, then installs them into Claude Code, Codex, OpenCode or any MCP client with one command.",
  ctaPrimary: "Start your library",
  ctaSecondary: "See how it works",
  heroCommand: "skillpack install code-review",
  heroRelease: "Immutable release",
  agentsLabel: "Installs into the agents your team already uses",
  problemKick: "The problem",
  problemTitlePre: "Today, your best skills are ",
  problemTitleMark: "scattered everywhere.",
  problemSub:
    "One engineer's review checklist lives in a gist. The deploy skill was pasted in Slack. Every agent runs a different copy, and nobody knows which one is current.",
  problemPunch: "Great skills exist. They just don't travel.",
  howKick: "How it works",
  howTitlePre: "One skill, from first draft to ",
  howTitleMark: "every agent.",
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
      desc: "One command installs the pinned version into each coding agent. Installed copies see updates when the checksum changes.",
    },
    {
      n: "04",
      title: "See what gets used",
      desc: "Agents can report each activation without signing in, and anyone can opt out. Find the skills that actually earn their place.",
    },
  ],
  agentsKick: "For coding agents",
  agentsTitlePre: "Agents connect as ",
  agentsTitleMark: "delegated clients.",
  agentsSub:
    "Agents sign in through Agent Auth, personal access tokens or the Skillpack MCP server. Each connection acts with the consenting member's rights, inside the one workspace chosen at consent.",
  agentsPoints: [
    { icon: "file-code", text: "Read, write and publish skills" },
    { icon: "database", text: "Use tenant-scoped Skill Databases" },
    { icon: "key-round", text: "Retrieve bound secrets through short-lived grants" },
  ],
  agentsNote: "Skillpack never launches your agents or runs skill package scripts.",
  trustTitlePre: "Self-hosted. Open source.",
  trustTitleMark: "Yours.",
  trustText:
    "Keep a skill private in My Skills or share it with your organization. Skillpack can run its control plane and skill registry on your own servers, so governance stays on infrastructure you control.",
  trustFacts: [
    { icon: "github", title: "MIT licensed", desc: "Read the code, fork it, run it. No black box." },
    { icon: "lock", title: "Private by default", desc: "Personal skills are visible to their creator only, with no admin override." },
    { icon: "shield-check", title: "Write-only secrets", desc: "Envelope-encrypted, referenced by id, never shown again." },
    { icon: "package", title: "Checksummed releases", desc: "Public releases pin exact, immutable versions." },
    { icon: "git-branch", title: "GitHub mirror", desc: "Sync organization skills to a repository you own." },
    { icon: "file-text", title: "Portable SKILL.md", desc: "An open format your skills can always leave with." },
  ],
  finaleTitlePre: "Build a skill once. ",
  finaleTitleMark: "Every agent uses it.",
  finaleSub: "Setup takes an afternoon. Your first shared skill can ship today.",
  finaleSmall: "Free and open source · MIT · runs on your own infrastructure if you want",
  finaleCta: "Get started",
  libInstall: "Install",
  libInstalled: "Installed",
  portalCaption: "click around: filter, pick a skill.",
  portalDescs: {
    "code-review": "Reviews diffs against the team checklist: tests, security, one summary comment.",
    deploy: "Ships to production with preflight checks and a rollback plan.",
    triage: "Sorts new issues, adds labels and asks for missing details.",
    "release-notes": "Drafts release notes from merged pull requests.",
    "migrate-db": "Plans safe schema changes with a backfill and a rollback.",
    "incident-notes": "Turns an incident channel into a timeline and follow-ups.",
  } satisfies Record<PortalSkillId, string>,
  footerByPre: "an open source tool by ",
  footerByCompany: "The Vibe Company",
  footerDocs: "Documentation",
};

type Copy = typeof COPY;

const AGENTS = [
  { name: "Claude Code", mono: "CC", tone: "terracotta" },
  { name: "Codex", mono: "Cx", tone: "slate" },
  { name: "OpenCode", mono: "OC", tone: "blue" },
  { name: "Any MCP client", mono: "M", tone: "violet" },
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

/* Portal rows — machine values stay literal, like a real screenshot. */
type PortalRow = {
  id: PortalSkillId;
  library: "personal" | "org";
  group: string;
  who: string;
  a: string;
  scopeLabel: string;
  ver: string;
  when: string;
  recent?: boolean;
  draft?: boolean;
};

const PORTAL_ROWS: PortalRow[] = [
  { id: "code-review", library: "org", group: "platform", who: "Marie", a: "violet", scopeLabel: "Organization", ver: "1.3.0", when: "2h ago", recent: true },
  { id: "deploy", library: "org", group: "infra", who: "Sam", a: "amber", scopeLabel: "Organization", ver: "3.0.1", when: "yesterday", recent: true },
  { id: "triage", library: "org", group: "support", who: "Jonas", a: "blue", scopeLabel: "Organization", ver: "2.2.0", when: "3d ago", recent: true },
  { id: "release-notes", library: "org", group: "product", who: "Léa", a: "terracotta", scopeLabel: "Organization", ver: "1.0.2", when: "1w ago" },
  { id: "migrate-db", library: "org", group: "platform", who: "Sam", a: "amber", scopeLabel: "Organization", ver: "1.1.0", when: "2w ago" },
  { id: "incident-notes", library: "personal", group: "operations", who: "You", a: "slate", scopeLabel: "My Skills", ver: "0.9.1", when: "4w ago", draft: true },
];
const SCOPE_ICON = { personal: "lock", org: "users" } satisfies Record<PortalRow["library"], string>;

/* ------------------------------------------------------------ utilities --- */

function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll(".v5-reveal"));
    let fired = false;
    const io = new IntersectionObserver(
      (entries) => {
        fired = true;
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("v5-reveal--in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.1 },
    );
    els.forEach((el) => io.observe(el));
    /* Fail open: if IO never fires (some embedded contexts), reveal everything. */
    const fallback = setTimeout(() => {
      if (!fired) els.forEach((el) => el.classList.add("v5-reveal--in"));
    }, 700);
    return () => {
      clearTimeout(fallback);
      io.disconnect();
    };
  }, []);
}

function Avatar({ who, tone, sm }: { who: string; tone: string; sm?: boolean }) {
  return (
    <span className={"v5-avatar v5-avatar--" + tone + (sm ? " v5-avatar--sm" : "")} aria-hidden="true">
      {who[0]}
    </span>
  );
}

/** Brand-gradient phrase used for the one highlighted idea in each headline. */
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

/* ------------------------------------------------------------- sections --- */

function Nav({ c }: { c: Copy }) {
  return (
    <header className="v10-nav">
      <div className="v10-wrap v10-nav__inner">
        <a className="v5-brand" href="#top" aria-label="Skillpack">
          <img className="v10-wordmark" src="/brand/skillpack-wordmark-dark-text.svg" alt="Skillpack" width={520} height={110} />
        </a>
        <nav className="v10-nav__links" aria-label="Sections">
          <a className="v10-nav__link" href="#how">
            {c.nav.how}
          </a>
          <a className="v10-nav__link" href="#agents">
            {c.nav.agents}
          </a>
          <a className="v10-nav__link" href="#open-source">
            {c.nav.openSource}
          </a>
        </nav>
        <span className="v10-nav__spacer"></span>
        <div className="v10-nav__actions">
          <a className="v10-btn v10-btn--ghost v10-btn--sm" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            {c.github} ↗
          </a>
          <Link href="/login" className="v10-btn v10-btn--primary v10-btn--sm">
            {c.navCta}
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero({ c }: { c: Copy }) {
  return (
    <section className="lp-hero" id="top" data-screen-label="hero">
      <div className="lp-hero__bg" aria-hidden="true"></div>
      <div className="v10-wrap lp-hero__inner">
        <span className="lp-badge lp-rise">
          <span className="lp-badge__dot" aria-hidden="true"></span>
          {c.heroBadge}
        </span>
        <h1 className="lp-h1 lp-rise lp-rise--2">
          {c.heroTitlePre}
          <Em>{c.heroTitleMark}</Em>
        </h1>
        <p className="lp-hero__sub lp-rise lp-rise--3">{c.heroSub}</p>
        <div className="lp-hero__ctas lp-rise lp-rise--4">
          <Link href="/login" className="v10-btn v10-btn--primary v10-btn--lg">
            {c.ctaPrimary}
          </Link>
          <a className="v10-btn v10-btn--ghost v10-btn--lg" href="#problem">
            {c.ctaSecondary}
          </a>
        </div>
        <div className="lp-hero__stage lp-rise lp-rise--5">
          <div className="lp-float lp-float--release" aria-hidden="true">
            <span className="lp-float__dot"></span>
            <span>
              <strong>{c.heroRelease}</strong>
              <code>code-review@1.3.0 · sha256:9f3c…a71e</code>
            </span>
          </div>
          <PortalCapture c={c} />
          <div className="lp-float lp-float--term" aria-hidden="true">
            <div className="lp-term__cmd">
              <span className="lp-term__prompt">❯</span> {c.heroCommand}
            </div>
            {AGENTS.slice(0, 3).map((a) => (
              <div className="lp-term__ok" key={a.name}>
                <Icon name="check" size={12} /> {a.name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AgentStrip({ c }: { c: Copy }) {
  return (
    <section className="lp-agents-strip" data-screen-label="agents-strip">
      <div className="v10-wrap lp-agents-strip__inner">
        <span className="lp-agents-strip__label">{c.agentsLabel}</span>
        <ul className="lp-agents-strip__list">
          {AGENTS.map((a) => (
            <li className="lp-agent" key={a.name}>
              <span className={"lp-agent__mono lp-tone--" + a.tone} aria-hidden="true">
                {a.mono}
              </span>
              {a.name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Problem({ c }: { c: Copy }) {
  return (
    <section className="lp-sec" id="problem" data-screen-label="the-problem">
      <div className="v10-wrap lp-split">
        <div>
          <p className="lp-kick">{c.problemKick}</p>
          <h2 className="lp-h2 v5-reveal">
            {c.problemTitlePre}
            <Em>{c.problemTitleMark}</Em>
          </h2>
          <p className="lp-sub v5-reveal">{c.problemSub}</p>
          <p className="lp-punch v5-reveal">{c.problemPunch}</p>
        </div>
        <div className="lp-scatter v5-reveal" aria-hidden="true">
          {SCATTER.map((f, i) => (
            <div className={"lp-file lp-file--" + (i + 1)} key={f.name}>
              <div className="lp-file__name">
                <Icon name="file-text" size={14} />
                {f.name}
              </div>
              <span className="lp-file__tag">
                <Icon name="alert-triangle" size={11} />
                {f.tag}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StepVisual({ n }: { n: string }) {
  if (n === "01") {
    return (
      <div className="lp-vis lp-vis--code" aria-hidden="true">
        <pre>
          <span className="lp-tok-k">name</span>: <span className="lp-tok-s">code-review</span>
          {"\n"}
          <span className="lp-tok-k">version</span>: <span className="lp-tok-n">1.3.0</span>
          {"\n"}
          <span className="lp-tok-c"># Review diffs against the checklist</span>
        </pre>
        <ul className="lp-checks">
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
      <div className="lp-vis lp-vis--share" aria-hidden="true">
        <div className="lp-lib">
          <span className="lp-lib__label">
            <Icon name="lock" size={12} /> My Skills
          </span>
          <span className="lp-chip lp-chip--ghost">code-review</span>
        </div>
        <span className="lp-share-arrow">
          <Icon name="arrow-right" size={16} />
        </span>
        <div className="lp-lib lp-lib--org">
          <span className="lp-lib__label">
            <Icon name="users" size={12} /> Organization
          </span>
          <span className="lp-chip lp-chip--on">
            code-review <code>v1.3.0</code>
          </span>
          <span className="lp-avatars">
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
      <div className="lp-vis lp-vis--term" aria-hidden="true">
        <div className="lp-term__cmd">
          <span className="lp-term__prompt">❯</span> skillpack install code-review
        </div>
        {AGENTS.slice(0, 3).map((a) => (
          <div className="lp-term__ok" key={a.name}>
            <Icon name="check" size={12} /> {a.name}
            <span className="lp-term__dim">code-review@1.3.0</span>
          </div>
        ))}
      </div>
    );
  }
  const bars = [18, 24, 21, 33, 30, 42, 38, 51, 47, 60, 57, 71, 68, 84];
  return (
    <div className="lp-vis lp-vis--usage" aria-hidden="true">
      <div className="lp-usage__head">
        <strong>12,480</strong> activations · last 30 days
      </div>
      <div className="lp-bars">
        {bars.map((b, i) => (
          <span key={i} style={{ height: `${b}%` }} className={i === bars.length - 1 ? "lp-bar lp-bar--now" : "lp-bar"} />
        ))}
      </div>
    </div>
  );
}

function How({ c }: { c: Copy }) {
  return (
    <section className="lp-sec lp-sec--dim" id="how" data-screen-label="how-it-works">
      <div className="v10-wrap">
        <p className="lp-kick lp-kick--center">{c.howKick}</p>
        <h2 className="lp-h2 lp-h2--center v5-reveal">
          {c.howTitlePre}
          <Em>{c.howTitleMark}</Em>
        </h2>
        <ol className="lp-steps">
          {c.steps.map((s) => (
            <li className="lp-step v5-reveal" key={s.n}>
              <div className="lp-step__text">
                <span className="lp-step__n">{s.n}</span>
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

const HUB_NODES = [
  { ...AGENTS[0], pos: "tl", d: "M 262 122 C 262 92, 123 98, 123 64" },
  { ...AGENTS[2], pos: "tr", d: "M 298 122 C 298 92, 437 98, 437 64" },
  { ...AGENTS[1], pos: "bl", d: "M 262 218 C 262 248, 123 242, 123 276" },
  { ...AGENTS[3], pos: "br", d: "M 298 218 C 298 248, 437 242, 437 276" },
] as const;

function HubDiagram() {
  return (
    <div className="lp-hub" aria-hidden="true">
      <svg className="lp-hub__wires" viewBox="0 0 560 340" preserveAspectRatio="none">
        <defs>
          <linearGradient id="lp-wire" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#EA580C" />
            <stop offset="1" stopColor="#F59E0B" />
          </linearGradient>
        </defs>
        {HUB_NODES.map((n) => (
          <g key={n.name}>
            <path d={n.d} className="lp-hub__wire" />
            <path d={n.d} className="lp-hub__pulse" stroke="url(#lp-wire)" pathLength={100} />
          </g>
        ))}
      </svg>
      <div className="lp-hub__core">
        <Mark size={52} />
      </div>
      {HUB_NODES.map((n) => (
        <div className={"lp-hub__node lp-hub__node--" + n.pos} key={n.name}>
          <span className={"lp-agent__mono lp-tone--" + n.tone}>{n.mono}</span>
          <span>
            <strong>{n.name}</strong>
            <code>v1.3.0</code>
          </span>
          <Icon name="circle-check" size={16} />
        </div>
      ))}
    </div>
  );
}

function Agents({ c }: { c: Copy }) {
  return (
    <section className="lp-sec" id="agents" data-screen-label="agents">
      <div className="v10-wrap lp-split lp-split--agents">
        <div>
          <p className="lp-kick">{c.agentsKick}</p>
          <h2 className="lp-h2 v5-reveal">
            {c.agentsTitlePre}
            <Em>{c.agentsTitleMark}</Em>
          </h2>
          <p className="lp-sub v5-reveal">{c.agentsSub}</p>
          <ul className="lp-points v5-reveal">
            {c.agentsPoints.map((p) => (
              <li key={p.text}>
                <span className="lp-pic" aria-hidden="true">
                  <Icon name={p.icon} size={15} />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
          <p className="lp-note v5-reveal">{c.agentsNote}</p>
        </div>
        <div className="v5-reveal">
          <HubDiagram />
        </div>
      </div>
    </section>
  );
}

function PortalCapture({ c }: { c: Copy }) {
  const [selected, setSelected] = useState<PortalSkillId>("code-review");
  const [installed, setInstalled] = useState<Record<string, boolean>>({ deploy: true });
  const [nav, setNav] = useState<PortalRow["library"]>("org");
  const [tab, setTab] = useState("all");

  let rows = PORTAL_ROWS.filter((r) => r.library === nav);
  if (tab === "recent") rows = rows.filter((r) => r.recent);

  const selectedId = rows.some((r) => r.id === selected) ? selected : rows[0]?.id;
  const sel = rows.find((r) => r.id === selectedId);
  const navLabel = nav === "personal" ? "My Skills" : null;

  const NavItem = ({ k, icon, label, count }: { k: PortalRow["library"]; icon: string; label: string; count: number }) => (
    <button
      type="button"
      className={"v6-reset-btn v5-portal__navitem" + (nav === k ? " v5-portal__navitem--active" : "")}
      aria-current={nav === k ? "true" : undefined}
      onClick={() => setNav(k)}
    >
      <Icon name={icon} size={14} /> {label} <span className="v5-portal__navcount">{count}</span>
    </button>
  );

  return (
    <div className="v10-libframe v6-pframe" data-screen-label="portal-capture">
      <div className="lp-frame__bar" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
        <code>skillpack.app/skills</code>
      </div>
      <div className="v5-portal">
        <aside className="v5-portal__side">
          <div className="v5-portal__org">
            <span className="v5-brand__mark v5-brand__mark--sm">A</span>
            Acme
          </div>
          <div className="v5-portal__grouplabel">Libraries</div>
          <NavItem k="personal" icon="user" label="My Skills" count={PORTAL_ROWS.filter((r) => r.library === "personal").length} />
          <NavItem k="org" icon="users" label="Organization" count={PORTAL_ROWS.filter((r) => r.library === "org").length} />
        </aside>
        <div className="v5-portal__main">
          <div className="v5-portal__head">
            <span className="v5-portal__title">{nav === "personal" ? "My Skills" : "Organization"}</span>
            <span className="v5-portal__count">{rows.length}</span>
            <span className="v5-portal__spacer"></span>
            <Link href="/login" className="cds-btn cds-btn--sm cds-btn--primary">
              Share a skill
            </Link>
          </div>
          <div className="v5-portal__viewbar">
            {(
              [
                ["all", "All skills"],
                ["recent", "Recently updated"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={"v6-reset-btn v5-portal__view" + (tab === k ? " v5-portal__view--active" : "")}
                aria-current={tab === k ? "true" : undefined}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="v5-portal__filterbar">
            <span className="v5-fchip">
              <Icon name="plus" size={11} /> Filter
            </span>
            {navLabel && (
              <span className="v5-fchip">
                <Icon name="lock" size={11} />
                {navLabel}
                <button type="button" className="v6-reset-btn v6-fchip-x" aria-label="Clear library filter" onClick={() => setNav("org")}>
                  <Icon name="x" size={11} />
                </button>
              </span>
            )}
          </div>
          <div className="v5-portal__chead" aria-hidden="true">
            <span></span>
            <span>Skill</span>
            <span>Library</span>
            <span>Version</span>
            <span style={{ textAlign: "right" }}>Updated</span>
          </div>
          {rows.map((r) => (
            <div
              key={r.id}
              className={"v5-portal__crow" + (r.id === selectedId ? " v5-portal__crow--active" : "")}
              role="button"
              tabIndex={0}
              aria-pressed={r.id === selectedId}
              onClick={() => setSelected(r.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelected(r.id);
                }
              }}
            >
              <span className={"v5-vdot" + (r.draft ? " v5-vdot--unknown" : "")}></span>
              <span className="v5-portal__name">{r.id}</span>
              <span className="v5-portal__scope">
                <Icon name={SCOPE_ICON[r.library]} size={11} />
                {r.scopeLabel}
              </span>
              <span className="v5-portal__ver">{r.ver}</span>
              <span className="v5-portal__when">{r.when}</span>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="v5-portal__cempty">
              {nav === "personal" ? "No recently updated skills in My Skills." : "No skills match these filters."}
            </div>
          )}
        </div>
        {sel ? (
          <aside className="v6-pdrawer" aria-labelledby={`portal-skill-${sel.id}`}>
            <div className="v6-pdrawer__head">
              <Avatar who={sel.who} tone={sel.a} sm />
              <h3 className="v6-pdrawer__title" id={`portal-skill-${sel.id}`}>
                {sel.id}
              </h3>
              <span className="v5-portal__scope">
                <Icon name={SCOPE_ICON[sel.library]} size={11} />
                {sel.scopeLabel}
              </span>
            </div>
            <p className="v6-pdrawer__desc">{c.portalDescs[sel.id]}</p>
            <dl className="v6-pdrawer__kv">
              <dt>{sel.library === "personal" ? "created by" : "shared by"}</dt>
              <dd>
                {sel.who} · {sel.group}
              </dd>
              <dt>version</dt>
              <dd>{sel.ver}</dd>
              <dt>updated</dt>
              <dd>{sel.when}</dd>
            </dl>
            <div className="v6-pdrawer__actions" aria-live="polite">
              <Button
                variant="primary"
                size="sm"
                aria-disabled={Boolean(installed[sel.id])}
                aria-pressed={Boolean(installed[sel.id])}
                onClick={() => {
                  if (!installed[sel.id]) setInstalled((s) => ({ ...s, [sel.id]: true }));
                }}
              >
                {installed[sel.id] ? c.libInstalled : c.libInstall}
              </Button>
            </div>
          </aside>
        ) : (
          <aside className="v6-pdrawer v6-pdrawer--empty" aria-label="Skill details">
            <p className="v6-pdrawer__desc">No skill selected.</p>
          </aside>
        )}
      </div>
      <div className="v5-libframe__caption">{c.portalCaption}</div>
    </div>
  );
}

function Trust({ c }: { c: Copy }) {
  return (
    <section className="lp-sec lp-sec--dim" id="open-source" data-screen-label="trust">
      <div className="v10-wrap">
        <h2 className="lp-h2 lp-h2--center lp-h2--xl v5-reveal">
          {c.trustTitlePre}
          <br />
          <Em>{c.trustTitleMark}</Em>
        </h2>
        <p className="lp-sub lp-sub--center v5-reveal">{c.trustText}</p>
        <div className="lp-facts">
          {c.trustFacts.map((f) => (
            <div className="lp-fact v5-reveal" key={f.title}>
              <span className="lp-pic" aria-hidden="true">
                <Icon name={f.icon} size={15} />
              </span>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Finale({ c }: { c: Copy }) {
  return (
    <section className="lp-finale" id="start" data-screen-label="finale">
      <div className="lp-finale__bg" aria-hidden="true"></div>
      <div className="v10-wrap lp-finale__inner">
        <Mark size={56} />
        <h2 className="lp-h2 lp-h2--center lp-h2--xl">
          {c.finaleTitlePre}
          <Em>{c.finaleTitleMark}</Em>
        </h2>
        <p className="lp-sub lp-sub--center">{c.finaleSub}</p>
        <div className="lp-hero__ctas">
          <Link href="/login" className="v10-btn v10-btn--primary v10-btn--lg">
            {c.finaleCta}
          </Link>
          <a className="v10-btn v10-btn--ghost v10-btn--lg" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            {c.github} ↗
          </a>
        </div>
        <p className="lp-finale__small">{c.finaleSmall}</p>
      </div>
    </section>
  );
}

function Footer({ c }: { c: Copy }) {
  return (
    <footer className="v10-footer">
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
  useReveal();

  return (
    <div className="v10-landing lp">
      <a className="v10-skip" href="#main-content">
        Skip to content
      </a>
      <Nav c={c} />
      <main id="main-content">
        <Hero c={c} />
        <AgentStrip c={c} />
        <Problem c={c} />
        <How c={c} />
        <Agents c={c} />
        <Trust c={c} />
        <Finale c={c} />
      </main>
      <Footer c={c} />
    </div>
  );
}
