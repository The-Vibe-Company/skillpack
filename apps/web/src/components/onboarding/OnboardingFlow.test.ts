// @vitest-environment happy-dom

/**
 * Product promise:
 * First-run setup is three fixed steps (Workspace, Team, Agent). The name typed on step one is
 * saved, nothing is created until the Team step's button says so, and joining by email domain
 * never creates a workspace.
 *
 * Regression caught:
 * The old flow dropped the typed name, showed "invites sent" before creating anything, changed the
 * stepper length mid-flow, and silently dropped invalid invite addresses.
 *
 * Why this test is component-level:
 * The risk is client state across steps plus the exact API calls; the API routes and persistence
 * are covered by core tests and the onboarding Playwright spec.
 *
 * Failure proof:
 * Creating on Continue, skipping the name save, losing the draft on Back, or calling create on the
 * join path fails the call and visible-text assertions below.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_BRAND_COLORS } from "@skillpack/contracts";
import type { OnboardingContext } from "@/lib/onboarding";
import { OnboardingFlow } from "./OnboardingFlow";

// SAFETY: React reads this optional global flag; declaring it only opts this test into act() semantics.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  completeOnboarding: vi.fn(),
  joinByDomain: vi.fn(),
  updateMe: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

// oxlint-disable-next-line anti-slop/no-module-mocking -- the App Router is not mounted in a component test.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh, replace: vi.fn() }),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- the profile API is replaced at the fetch boundary.
vi.mock("@/lib/org", () => ({ updateMe: mocks.updateMe }));
// oxlint-disable-next-line anti-slop/no-module-mocking -- only the two API calls are replaced; the form helpers stay real.
vi.mock("@/lib/onboarding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/onboarding")>()),
  completeOnboarding: mocks.completeOnboarding,
  joinByDomain: mocks.joinByDomain,
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- the favicon lookup loads third-party images.
vi.mock("./useBrandIcon", () => ({ useBrandIcon: () => null }));
// oxlint-disable-next-line anti-slop/no-module-mocking -- the agent step has its own suite; this one proves the handoff props.
vi.mock("./ConnectAgentStep", () => ({
  ConnectAgentStep: (props: { workspaceId: string; workspaceName: string; invitedCount: number | null }) =>
    React.createElement(
      "div",
      { "data-testid": "agent-step" },
      `agent:${props.workspaceId}:${props.workspaceName}:${props.invitedCount ?? "none"}`,
    ),
}));

const corporate: OnboardingContext = { email: "alex@acme.test", domain: "acme.test", isPersonal: false, matchedOrgs: [] };
const roots: Root[] = [];

async function mount(
  context: OnboardingContext = corporate,
  me = { name: "alex", email: "alex@acme.test" },
  extra: Partial<React.ComponentProps<typeof OnboardingFlow>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(React.createElement(OnboardingFlow, { context, me, ...extra }));
  });
  return container;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

function input(container: HTMLElement, id: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(el: HTMLInputElement, keyName: string) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true }));
  });
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`button "${label}" not found`);
  return found;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await settle();
}

function progressItems(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".ob-progress__item")).map(
    (item) => `${item.querySelector(".ob-progress__label")?.textContent}:${item.className.split("--").pop()}`,
  );
}

describe("OnboardingFlow", () => {
  beforeEach(() => {
    mocks.completeOnboarding.mockReset().mockResolvedValue({ ok: true, orgId: "org-new", invited: ["sam@acme.test", "jo@acme.test"] });
    mocks.joinByDomain.mockReset().mockResolvedValue({ ok: true, orgId: "org-2" });
    mocks.updateMe.mockReset().mockResolvedValue({ id: "u1", name: "Alex", initials: "A" });
    mocks.push.mockReset();
    vi.spyOn(window.history, "replaceState");
  });

  afterEach(() => {
    act(() => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("creates the workspace and sends invitations only from the Team step", async () => {
    const container = await mount();
    expect(progressItems(container)).toEqual(["Workspace:current", "Team:todo", "Agent:todo"]);
    expect(input(container, "ob-name").value).toBe("Alex");
    expect(input(container, "ob-workspace").value).toBe("Acme");

    await click(button(container, "Continue"));
    expect(mocks.updateMe).toHaveBeenCalledWith("Alex");
    expect(mocks.completeOnboarding).not.toHaveBeenCalled();
    expect(progressItems(container)).toEqual(["Workspace:done", "Team:current", "Agent:todo"]);

    const invite = input(container, "ob-invite");
    await type(invite, "not-an-email");
    await key(invite, "Enter");
    expect(container.textContent).toContain("Enter a valid email address.");
    await type(invite, "sam@acme.test");
    await key(invite, "Enter");
    await type(invite, "jo@acme.test");
    expect(button(container, "Create and invite 2")).toBeTruthy();
    expect(mocks.completeOnboarding).not.toHaveBeenCalled();

    await click(button(container, "Create and invite 2"));

    expect(mocks.completeOnboarding).toHaveBeenCalledTimes(1);
    const payload = mocks.completeOnboarding.mock.calls[0]![0];
    expect(payload).toMatchObject({
      org: { name: "Acme", domain: "acme.test", autoJoin: true, logoUrl: null },
      invites: ["sam@acme.test", "jo@acme.test"],
    });
    expect(TEAM_BRAND_COLORS).toContain(payload.org.color);
    expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/onboarding?step=agent");
    expect(container.querySelector("[data-testid=agent-step]")?.textContent).toBe("agent:org-new:Acme:2");
    expect(progressItems(container)).toEqual(["Workspace:done", "Team:done", "Agent:current"]);
  });

  it("keeps the draft on Back and does not re-save an unchanged name", async () => {
    const container = await mount();
    await type(input(container, "ob-workspace"), "Acme Labs");
    await click(button(container, "Continue"));
    const invite = input(container, "ob-invite");
    await type(invite, "sam@acme.test");
    await key(invite, "Enter");

    await click(button(container, "Back"));
    expect(input(container, "ob-workspace").value).toBe("Acme Labs");
    await click(button(container, "Continue"));

    expect(container.textContent).toContain("sam@acme.test");
    expect(mocks.updateMe).toHaveBeenCalledTimes(1);
  });

  it("stays on the Team step with the reason when creation fails", async () => {
    mocks.completeOnboarding.mockRejectedValueOnce(new Error("verify your email to enable domain access"));
    const container = await mount();
    await click(button(container, "Continue"));
    await click(button(container, "Create workspace"));

    expect(container.querySelector("[role=alert]")?.textContent).toBe("verify your email to enable domain access");
    expect(button(container, "Create workspace").disabled).toBe(false);
    expect(container.querySelector("[data-testid=agent-step]")).toBeNull();
  });

  it("joins the selected domain workspace without creating one", async () => {
    const container = await mount({
      ...corporate,
      matchedOrgs: [
        { id: "org-1", name: "Acme", domain: "acme.test", memberCount: 4 },
        { id: "org-2", name: "Beta", domain: "acme.test", memberCount: 1 },
      ],
    });
    expect(container.textContent).toContain("Join a workspace");
    const beta = container.querySelectorAll<HTMLInputElement>("input[type=radio]")[1]!;
    await act(async () => {
      beta.click();
    });

    await click(button(container, "Join Beta"));

    expect(mocks.joinByDomain).toHaveBeenCalledWith("org-2");
    expect(mocks.completeOnboarding).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid=agent-step]")?.textContent).toBe("agent:org-2:Beta:none");
    expect(progressItems(container)).toEqual(["Workspace:done", "Team:done", "Agent:current"]);
    expect(container.textContent).toContain("not needed when joining");
  });

  it("asks for a name when the account only has an email address", async () => {
    const container = await mount(
      { email: "jordan42@gmail.test", domain: "gmail.test", isPersonal: true, matchedOrgs: [] },
      { name: "jordan42@gmail.test", email: "jordan42@gmail.test" },
    );
    expect(input(container, "ob-name").value).toBe("");
    expect(input(container, "ob-workspace").value).toBe("");
    expect(button(container, "Continue").disabled).toBe(true);
    expect(container.textContent).not.toContain("Allow verified");
  });

  it("opens directly on the agent step after a reload", async () => {
    const container = await mount(corporate, { name: "Alex", email: "alex@acme.test" }, {
      initialStep: "agent",
      workspace: { id: "org-1", name: "Acme" },
    });
    expect(container.querySelector("[data-testid=agent-step]")?.textContent).toBe("agent:org-1:Acme:none");
  });
});
