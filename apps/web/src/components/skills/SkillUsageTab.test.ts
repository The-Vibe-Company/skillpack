import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SkillUsageSummary } from "@skillpack/contracts";
import { SkillUsageReport } from "./SkillUsageTab";
const empty: SkillUsageSummary = { retention_days: 90, total: 0, requests: 0, reads: 0, historical: 0, adapters: [], anonymous: 0, daily: [], agents: [], environments: [], identities: [], identities_truncated: false };
describe("reported usage", () => {
  it("does not equate missing reports with no usage", () => {
    const html = renderToStaticMarkup(React.createElement(SkillUsageReport, { usage: empty }));
    expect(html).toContain("No invocations observed");
    expect(html).toContain("Collection can be disabled or unavailable");
  });
  it("labels declared identities as unverified and separates anonymous reports", () => {
    const usage = { ...empty, total: 3, anonymous: 1, identities: [{ user_id: null, email: "bot@example.test", source: "git-local", count: 2 }] };
    const html = renderToStaticMarkup(React.createElement(SkillUsageReport, { usage }));
    expect(html).toContain("unverified");
    expect(html).toContain("bot@example.test");
    expect(html).toContain("anonymous");
    expect(html).toContain("not verified accounts");
  });
});

it("keeps requests, reads and historical reports separate from observed invocations", () => {
  const html = renderToStaticMarkup(React.createElement(SkillUsageReport, { usage: {
    ...empty, requests: 2, reads: 5, historical: 7,
    adapters: [{ label: "codex-hook", count: 2 }],
  } }));
  expect(html).toContain("No invocations observed");
  expect(html).toContain("Invocation requests");
  expect(html).toContain("Observed reads");
  expect(html).toContain("Historical agent reports");
  expect(html).toContain("codex-hook");
  expect(html).not.toContain("14 observed invocations");
});
