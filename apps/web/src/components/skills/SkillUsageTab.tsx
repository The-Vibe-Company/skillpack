"use client";

import { useEffect, useState } from "react";
import type { SkillUsageCount, SkillUsageSummary } from "@skillpack/contracts";
import { fetchSkillUsage } from "@/lib/queries";

function Counts({ title, rows, metric = "Invocations" }: { title: string; rows: SkillUsageCount[]; metric?: string }) {
  return <section className="usage-section">
    <h3>{title}</h3>
    <table className="usage-table">
      <thead><tr><th scope="col">{title === "Daily invocations (UTC)" ? "Date" : "Source"}</th><th scope="col">{metric}</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.count.toLocaleString()}</td></tr>)}</tbody>
    </table>
  </section>;
}

export function SkillUsageReport({ usage }: { usage: SkillUsageSummary }) {
  return <div className="ddoc skill-usage">
    <h2>Observed skill usage</h2>
    <p className="usage-note">Last {usage.retention_days} days · Collection can be disabled or unavailable. An invocation means the agent reported a successful skill tool call; it does not prove the instructions were followed.</p>
    {usage.total === 0 ? <p role="status">No invocations observed. Install or update Skillpack to configure local collection; check runtime doctor for hook coverage.</p> : <>
      <p><strong>{usage.total.toLocaleString()}</strong> observed invocations · <strong>{usage.anonymous.toLocaleString()}</strong> anonymous</p>
      <div className="usage-breakdowns">
        <Counts title="Agents" rows={usage.agents} />
        <Counts title="Environments" rows={usage.environments} />
      </div>
      <section className="usage-section">
        <h3>Declared identities · unverified</h3>
        <p className="usage-note">An email may belong to a bot, and one person may use several identities. These are not verified accounts or a count of unique people.</p>
        {usage.identities.length === 0 ? <p>All observed invocations are anonymous.</p> : <div className="usage-scroll" tabIndex={0} role="region" aria-label="Declared identities">
          <table className="usage-table">
            <thead><tr><th scope="col">Email</th><th scope="col">Declared ID</th><th scope="col">Source</th><th scope="col">Invocations</th></tr></thead>
            <tbody>{usage.identities.map((row) => <tr key={JSON.stringify([row.user_id, row.email, row.source])}>
              <td>{row.email ?? "—"}</td><td>{row.user_id ?? "—"}</td><td>{row.source}</td><td>{row.count.toLocaleString()}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        {usage.identities_truncated && <p className="usage-note">Showing the 500 most active declared identities.</p>}
      </section>
      <Counts title="Daily invocations (UTC)" rows={usage.daily} />
    </>}
    <div className="usage-breakdowns">
      <Counts title="Other observations" metric="Observations" rows={[
        { label: "Invocation requests", count: usage.requests },
        { label: "Observed reads", count: usage.reads },
      ]} />
      <Counts title="Collection adapters" metric="Observations" rows={usage.adapters} />
    </div>
    <p className="usage-note">Requests and reads are separate signals, not additional invocations. Adapter counts include all new observations.</p>
    <section className="usage-section">
      <h3>Historical agent reports</h3>
      <p>{usage.historical.toLocaleString()} reports from the retired instruction-based system within this {usage.retention_days}-day window. Kept separate from runtime observations.</p>
    </section>
  </div>;
}

export function SkillUsageTab({ slug }: { slug: string }) {
  const [usage, setUsage] = useState<SkillUsageSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setUsage(null);
    setFailed(false);
    fetchSkillUsage(slug).then((result) => {
      if (!cancelled) setUsage(result);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [slug, attempt]);
  if (failed) return <div className="ddoc"><p role="alert">Could not load usage.</p><button className="btn-sec" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>;
  if (!usage) return <div className="ddoc" role="status">Loading skill usage…</div>;
  return <SkillUsageReport usage={usage} />;
}
