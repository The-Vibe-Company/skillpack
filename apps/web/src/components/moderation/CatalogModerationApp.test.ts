// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogModerationSubmission, CatalogModerationView, CatalogSkillReportsState } from "@/lib/catalogModeration";

const navigationMocks = vi.hoisted(() => ({ refresh: vi.fn() }));
// oxlint-disable-next-line anti-slop/no-module-mocking -- the app router is absent in a unit render; refresh is the observable outcome.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: navigationMocks.refresh }) }));

import { CatalogModerationApp } from "./CatalogModerationApp";

// SAFETY: React reads this documented global flag to enable act() semantics in a test renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORG = "2b7d8a30-1c5e-4f7a-8f43-0b0d3c2a1e10";

function submission(overrides: Partial<CatalogModerationSubmission> = {}): CatalogModerationSubmission {
  return {
    id: "8d4c5a52-4ad6-4c43-9d1b-6b6fbc0f0c01",
    org_id: ORG,
    skill_id: "5f3e2d1c-0b9a-4876-9543-2a1b0c9d8e7f",
    skill_version_id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    package_checksum: `sha256:${"c".repeat(64)}`,
    status: "proposed",
    kind: "submission",
    rejection_reason: null,
    created_at: "2026-10-01T09:00:00.000Z",
    decided_at: null,
    check_status: "passed",
    check_reason: null,
    ...overrides,
  };
}

const QUEUE: CatalogModerationView = { view: "queue", status: "proposed", offset: 0 };
const NO_REPORTS: CatalogSkillReportsState = { status: "unavailable" };

let root: Root | null = null;
let container: HTMLDivElement;

function render(props: Partial<React.ComponentProps<typeof CatalogModerationApp>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(React.createElement(CatalogModerationApp, {
      view: QUEUE,
      submissions: [submission()],
      hasNextPage: false,
      reports: NO_REPORTS,
      ...props,
    }));
  });
}

function button(label: string, scope: ParentNode = container): HTMLButtonElement {
  const match = Array.from(scope.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`No button labelled ${label}`);
  return match;
}

function buttonLabels(scope: ParentNode = container): string[] {
  return Array.from(scope.querySelectorAll("button")).map((candidate) => candidate.textContent?.trim() ?? "");
}

function dialog(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[role=dialog]");
  if (!element) throw new Error("No dialog open");
  return element;
}

function typeReason(value: string) {
  const textarea = dialog().querySelector("textarea")!;
  act(() => {
    // SAFETY: the native value setter is the documented way to drive a React-controlled textarea.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(target: HTMLElement) {
  await act(async () => {
    target.click();
  });
}

describe("CatalogModerationApp", () => {
  beforeEach(() => {
    navigationMocks.refresh.mockReset();
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("shows identities, check summaries and only the decisions valid for each status", () => {
    render({
      submissions: [
        submission(),
        submission({ id: "8d4c5a52-4ad6-4c43-9d1b-6b6fbc0f0c02", check_status: "failed", check_reason: "GPL-3.0 is not an accepted license" }),
        submission({ id: "8d4c5a52-4ad6-4c43-9d1b-6b6fbc0f0c03", check_status: "pending" }),
      ],
    });

    const cards = Array.from(container.querySelectorAll("article"));
    expect(cards).toHaveLength(3);
    expect(cards[0]!.textContent).toContain(ORG);
    expect(cards[0]!.textContent).toContain(`sha256:${"c".repeat(64)}`);
    expect(cards[0]!.textContent).toContain("Checks passed");
    expect(button("Validate", cards[0]!).disabled).toBe(false);

    expect(cards[1]!.textContent).toContain("Checks failed");
    expect(cards[1]!.textContent).toContain("GPL-3.0 is not an accepted license");
    expect(button("Validate", cards[1]!).disabled).toBe(true);
    expect(cards[2]!.textContent).toContain("Checks pending");
    const pendingValidate = button("Validate", cards[2]!);
    expect(pendingValidate.disabled).toBe(true);
    expect(document.getElementById(pendingValidate.getAttribute("aria-describedby")!)?.textContent).toContain("automatic checks pass");

    expect(cards.every((card) => button("Ban organization", card))).toBe(true);
    expect(buttonLabels(cards[0]!)).toEqual(["Validate", "Reject", "Ban organization"]);
  });

  it("offers removal, not validation, for listed skills and shows prior decision reasons", () => {
    render({
      view: { view: "queue", status: "validated", offset: 0 },
      submissions: [submission({ status: "validated", decided_at: "2026-10-02T09:00:00.000Z" })],
    });
    expect(buttonLabels()).toEqual(["Remove listing", "Ban organization"]);
    expect(container.textContent).not.toContain("Checks pending");
    expect(container.textContent).toContain("Decided Oct 2, 2026");
    act(() => root!.unmount());

    render({
      view: { view: "queue", status: "rejected", offset: 0 },
      submissions: [submission({ status: "rejected", rejection_reason: "Unsupported license" })],
    });
    expect(container.textContent).toContain("Unsupported license");
    expect(buttonLabels()).toEqual(["Ban organization"]);
  });

  it("validates after confirmation, then refreshes the queue and confirms the outcome", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    render();

    await click(button("Validate"));
    expect(dialog().textContent).toContain("Validate submission");
    expect(dialog().querySelector("textarea")).toBeNull();
    await click(button("Validate", dialog()));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe(`/v1/platform/catalog/organizations/${ORG}/submissions/8d4c5a52-4ad6-4c43-9d1b-6b6fbc0f0c01/validate`);
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(navigationMocks.refresh).toHaveBeenCalledOnce();
    expect(document.querySelector("[role=status]")?.textContent).toBe("Submission validated and listed.");
  });

  it("requires a reason to reject and keeps the dialog open with the API's reason on conflict", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ error: "only a proposed catalog submission can be rejected" }, { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    render();

    await click(button("Reject"));
    const confirm = button("Reject", dialog());
    expect(confirm.disabled).toBe(true);
    typeReason("   ");
    expect(confirm.disabled).toBe(true);
    typeReason("Unsupported license");
    expect(confirm.disabled).toBe(false);
    await click(confirm);

    expect(fetchMock.mock.calls[0]![1]?.body).toBe(JSON.stringify({ reason: "Unsupported license" }));
    expect(dialog().querySelector("[role=alert]")?.textContent).toContain("only a proposed catalog submission can be rejected");
    expect(navigationMocks.refresh).not.toHaveBeenCalled();
  });

  it("bans the submitting organization with a reason", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    render();

    await click(button("Ban organization"));
    expect(dialog().textContent).toContain(ORG);
    typeReason("Repeated malware submissions");
    await click(button("Ban organization", dialog()));

    expect(fetchMock.mock.calls[0]![0]).toBe(`/v1/platform/catalog/organizations/${ORG}/ban`);
    expect(fetchMock.mock.calls[0]![1]?.body).toBe(JSON.stringify({ reason: "Repeated malware submissions" }));
    expect(document.querySelector("[role=status]")?.textContent).toBe("Organization banned from publishing.");
  });

  it("explains an empty queue and links every status tab", () => {
    render({ submissions: [] });

    expect(container.textContent).toContain("No submissions waiting");
    const tabs = Array.from(container.querySelectorAll<HTMLAnchorElement>("nav[aria-label='Moderation views'] a"));
    expect(tabs.map((tab) => tab.getAttribute("href"))).toEqual([
      "/platform/catalog?status=proposed",
      "/platform/catalog?status=validated",
      "/platform/catalog?status=rejected",
      "/platform/catalog?status=removed",
      "/platform/catalog?view=reports",
    ]);
    expect(tabs[0]!.getAttribute("aria-current")).toBe("page");
  });

  it("pages forward and back within the selected status", () => {
    render({ view: { view: "queue", status: "removed", offset: 20 }, hasNextPage: true });

    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>("nav[aria-label='Pagination'] a")).map((link) => link.getAttribute("href"));
    expect(links).toEqual(["/platform/catalog?status=removed", "/platform/catalog?status=removed&offset=40"]);
    expect(container.textContent).toContain("Page 2");
  });

  it("says reports are not connected yet, and renders them once the reporting API supplies them", () => {
    render({ view: { view: "reports" }, submissions: [] });
    expect(container.textContent).toContain("Skill reports aren't connected yet");
    act(() => root!.unmount());

    render({
      view: { view: "reports" },
      submissions: [],
      reports: {
        status: "ready",
        reports: [{
          id: "r1",
          org_id: ORG,
          skill_id: "5f3e2d1c-0b9a-4876-9543-2a1b0c9d8e7f",
          submission_id: null,
          reason: "Malicious content",
          details: "Exfiltrates environment variables",
          created_at: "2026-10-03T09:00:00.000Z",
        }],
      },
    });
    expect(container.textContent).toContain("Malicious content");
    expect(container.textContent).toContain("Exfiltrates environment variables");
    expect(container.textContent).toContain(ORG);
  });
});
