"use client";

/* Interactive hero library demo. It mirrors the real Skills list but is
   presentational, not API-wired; PortalDemo lazy-loads it. */

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/cds";
import { Icon } from "@/components/Icon";
import { Avatar } from "./Avatar";

type PortalSkillId = "code-review" | "deploy" | "triage" | "release-notes" | "migrate-db" | "incident-notes";

const COPY = {
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
};

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

export function PortalCapture() {
  const c = COPY;
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
