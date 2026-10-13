/* Landing comparison: Skillpack against two categories of sharing, never named products.
   Every Skillpack cell maps to repository behavior; category cells stay generic and use
   "Varies" whenever a statement would not hold for every product or setup. */

import { Fragment } from "react";

type ComparisonRow = { feature: string; skillpack: React.ReactNode; directories: string; gists: string };

const COMPARISON_COPY = {
  kick: "Compare",
  titleMark: "Skillpack",
  titlePost: " vs public skills directories vs gists and Slack",
  sub: "Public directories help people discover skills. Gists and Slack threads pass a copy along. Skillpack is the private, versioned registry for the skills your team actually runs.",
  caption: "Skillpack compared with public skills directories and with sharing skills through gists or Slack. “Varies” means it depends on the product or setup.",
  columns: { feature: "Capability", skillpack: "Skillpack", directories: "Public skills directories", gists: "Gists & Slack" },
};

/* Commands wrap only between arguments, so flags like --frozen never split at their hyphens. */
function Cmd({ children }: { children: string }) {
  return (
    <code>
      {children.split(" ").map((arg, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span>{arg}</span>
        </Fragment>
      ))}
    </code>
  );
}

const COMPARISON_ROWS: ComparisonRow[] = [
  {
    feature: "Private, organization-scoped skills",
    skillpack: "Creator-only My Skills plus an organization library every member shares",
    directories: "Public listing",
    gists: "Varies",
  },
  {
    feature: "Immutable versions",
    skillpack: "Each published version is immutable and carries a sha256 checksum",
    directories: "Varies",
    gists: "Editable in place",
  },
  {
    feature: "Lockfile with sha256 checksums",
    skillpack: (
      <>
        Installs are recorded in a lockfile; <Cmd>skillpack sync --frozen</Cmd> verifies them
      </>
    ),
    directories: "Varies",
    gists: "None",
  },
  {
    feature: "Self-hostable",
    skillpack: "Yes, MIT-licensed open source",
    directories: "Varies",
    gists: "Varies",
  },
  {
    feature: "Install into several agents in one command",
    skillpack: <Cmd>skillpack install &lt;slug&gt; --tools codex,claude-code,opencode</Cmd>,
    directories: "Varies",
    gists: "Manual copy",
  },
  {
    feature: "Write-only secrets",
    skillpack: "Envelope-encrypted and write-only; agents retrieve them through constrained grants",
    directories: "Varies",
    gists: "None",
  },
  {
    feature: "Validation before publish",
    skillpack: (
      <>
        <Cmd>skillpack skills validate</Cmd> checks the package; publishing validates SKILL.md, manifest, dependencies and
        secrets
      </>
    ),
    directories: "Varies",
    gists: "None",
  },
];

export function Comparison() {
  const c = COMPARISON_COPY;

  return (
    <section className="lp-sec" id="compare" data-screen-label="comparison">
      <div className="v10-wrap">
        <p className="lp-kick lp-kick--center">{c.kick}</p>
        <h2 className="lp-h2 lp-h2--center v5-reveal">
          <em className="lp-em">{c.titleMark}</em>
          {c.titlePost}
        </h2>
        <p className="lp-sub lp-sub--center v5-reveal">{c.sub}</p>
        {/* Focusable so keyboard users can scroll the table when it overflows on narrow screens. */}
        <div className="lp-compare v5-reveal" role="region" aria-labelledby="lp-compare-caption" tabIndex={0}>
          <table className="lp-compare__table">
            <caption id="lp-compare-caption">{c.caption}</caption>
            <thead>
              <tr>
                <th scope="col">{c.columns.feature}</th>
                <th scope="col" className="lp-compare__us">
                  {c.columns.skillpack}
                </th>
                <th scope="col">{c.columns.directories}</th>
                <th scope="col">{c.columns.gists}</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.feature}>
                  <th scope="row">{row.feature}</th>
                  <td className="lp-compare__us">{row.skillpack}</td>
                  <td>{row.directories}</td>
                  <td>{row.gists}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
