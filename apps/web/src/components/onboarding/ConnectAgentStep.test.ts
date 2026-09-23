// @vitest-environment happy-dom

/**
 * Product promise:
 * The last onboarding step hands the Skillpack setup prompt to the member's coding agent and flips
 * to "Connected" on its own once the agent reports the install, without credentials in the browser.
 *
 * Regression caught:
 * A prompt for the wrong agent, a "Copied" claim after a blocked clipboard, polling that never
 * stops, or a late response overwriting newer state would strand the member on this step.
 *
 * Why this test is component-level:
 * The risk is polling, clipboard, and React state; the install report itself is covered by the API
 * integration tests and the onboarding Playwright spec.
 *
 * Failure proof:
 * Dropping the poll, the stop-when-connected guard, the clipboard fallback, or the agent name fill
 * fails the visible-text, fetch-count, and clipboard assertions below.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GettingStartedState, LocalSkillRow } from "@skillpack/contracts";
import { ConnectAgentStep } from "./ConnectAgentStep";

// SAFETY: React reads this optional global flag; declaring it only opts this test into act() semantics.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const queryMocks = vi.hoisted(() => ({
  fetchLocalSkills: vi.fn(),
  fetchGettingStarted: vi.fn(),
}));

// oxlint-disable-next-line anti-slop/no-module-mocking -- the API client is replaced at the fetch boundary to drive polling.
vi.mock("@/lib/queries", () => ({
  apiBase: () => "https://skillpack.example/v1",
  fetchLocalSkills: queryMocks.fetchLocalSkills,
  fetchGettingStarted: queryMocks.fetchGettingStarted,
}));

const waiting: GettingStartedState = {
  companion_installed_at: null,
  local_reviewed_at: null,
  org_reviewed_at: null,
  completed_at: null,
  dismissed_at: null,
  completed: false,
  first_incomplete_step: "companion_install",
};
const connected: GettingStartedState = {
  ...waiting,
  companion_installed_at: "2026-09-23T10:00:00.000Z",
  first_incomplete_step: "local_review",
};

const skill: LocalSkillRow = {
  workspaceId: "org-1",
  key: "skillpack",
  name: "Skillpack",
  description: "Manage skills locally.",
  status: "none",
  installedVersion: null,
  availableVersion: "1.115.0",
  lastReportedAt: null,
  agentLabel: null,
  notes: "",
  commands: [],
  changes: [],
  integrity: { packageChecksum: `sha256:${"a".repeat(64)}`, files: { "SKILL.md": `sha256:${"b".repeat(64)}` } },
  prompts: {
    install: "install",
    update: "update",
    use: "use",
    onboarding: "onboard {base} {workspaceId} in {tool} {token}",
    resume: "resume {base} {workspaceId} in {tool}",
  },
};

const roots: Root[] = [];
let onFinish: ReturnType<typeof vi.fn>;
let writeText: ReturnType<typeof vi.fn>;

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      React.createElement(ConnectAgentStep, { workspaceId: "org-1", workspaceName: "Acme", invitedCount: 2, onFinish }),
    );
  });
  await flush();
  return { container, root };
}

async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

function button(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
}

describe("ConnectAgentStep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    queryMocks.fetchLocalSkills.mockReset().mockResolvedValue([skill]);
    queryMocks.fetchGettingStarted.mockReset().mockResolvedValue(waiting);
    onFinish = vi.fn();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  });

  afterEach(() => {
    act(() => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("flips to Connected once the agent reports the install, then stops polling", async () => {
    const { container } = await mount();
    expect(queryMocks.fetchLocalSkills).toHaveBeenCalledWith("org-1");
    expect(container.textContent).toContain("Invited 2 people.");
    expect(container.textContent).toContain("Waiting for your agent");
    expect(button(container, "Skip for now")).toBeTruthy();

    queryMocks.fetchGettingStarted.mockResolvedValue(connected);
    await tick(3000);

    expect(container.textContent).toContain("Connected");
    expect(button(container, "Skip for now")).toBeUndefined();
    const calls = queryMocks.fetchGettingStarted.mock.calls.length;
    await tick(9000);
    expect(queryMocks.fetchGettingStarted.mock.calls.length).toBe(calls);

    await act(async () => {
      button(container, "Open Skillpack")?.click();
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("copies the onboarding prompt for the chosen agent without a token", async () => {
    const { container } = await mount();
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Codex"))?.click();
    });
    expect(container.textContent).toContain("Paste this into Codex");

    await act(async () => {
      button(container, "Copy prompt")?.click();
    });
    await flush();

    expect(writeText).toHaveBeenCalledWith(
      "onboard https://skillpack.example/v1 org-1 in Codex [PAT intentionally omitted; use Agent Auth]",
    );
    expect(container.textContent).toContain("Copied");
    expect(window.localStorage.getItem("skillpack:preferred-agent")).toBe("codex");
  });

  it("uses the resume prompt when the skill is already installed", async () => {
    queryMocks.fetchGettingStarted.mockResolvedValue(connected);
    const { container } = await mount();
    expect(container.textContent).toContain("Connected");
    await act(async () => {
      button(container, "Copy prompt")?.click();
    });
    await flush();
    expect(writeText).toHaveBeenCalledWith("resume https://skillpack.example/v1 org-1 in Claude Code");
  });

  it("shows the prompt for manual copy instead of claiming success when the clipboard is blocked", async () => {
    writeText.mockRejectedValue(new Error("blocked"));
    const { container } = await mount();
    await act(async () => {
      button(container, "Copy prompt")?.click();
    });
    await flush();

    expect(container.textContent).toContain("Copy failed. Select the prompt and copy it manually.");
    expect(container.querySelector("details")?.open).toBe(true);
    expect(button(container, "Copied")).toBeUndefined();
  });

  it("ignores a status response that lands after unmount", async () => {
    let resolveLate: (state: GettingStartedState) => void = () => {};
    const { root } = await mount();
    queryMocks.fetchGettingStarted.mockReturnValueOnce(new Promise((resolve) => { resolveLate = resolve; }));
    await tick(3000);
    act(() => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    await act(async () => {
      resolveLate(connected);
    });
    const calls = queryMocks.fetchGettingStarted.mock.calls.length;
    await tick(9000);
    expect(queryMocks.fetchGettingStarted.mock.calls.length).toBe(calls);
  });

  it("offers a retry when the setup prompt cannot load", async () => {
    queryMocks.fetchLocalSkills.mockRejectedValueOnce(new Error("offline"));
    const { container } = await mount();
    expect(container.textContent).toContain("Couldn’t load the setup prompt.");
    await act(async () => {
      button(container, "Try again")?.click();
    });
    await flush();
    expect(container.textContent).toContain("Paste this into Claude Code");
  });

  it("lets the member skip", async () => {
    const { container } = await mount();
    await act(async () => {
      button(container, "Skip for now")?.click();
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
