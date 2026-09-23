/* oxlint-disable anti-slop/no-module-mocking, anti-slop/no-unknown-parameters -- This route-state harness mocks the server boundaries it proves; the onboarding cases extend the same seams. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ loadServerAuth: vi.fn() }));
const navigationMocks = vi.hoisted(() => ({ redirect: vi.fn() }));
const componentMocks = vi.hoisted(() => ({
  AuthUnavailable: () => null,
  WorkspaceLoadError: () => null,
  SessionKeepAlive: () => null,
  LoginForm: () => null,
  AcceptInvite: () => null,
  OnboardingFlow: () => null,
}));

vi.mock("./serverAuth", () => authMocks);
vi.mock("next/navigation", () => navigationMocks);
vi.mock("@/components/org/WorkspaceLoadError", () => ({
  AuthUnavailable: componentMocks.AuthUnavailable,
  WorkspaceLoadError: componentMocks.WorkspaceLoadError,
}));
vi.mock("@/components/auth/SessionKeepAlive", () => ({ SessionKeepAlive: componentMocks.SessionKeepAlive }));
vi.mock("@/app/(auth)/login/LoginForm", () => ({ LoginForm: componentMocks.LoginForm }));
vi.mock("@/components/org/AcceptInvite", () => ({ AcceptInvite: componentMocks.AcceptInvite }));
vi.mock("@/components/onboarding/OnboardingFlow", () => ({ OnboardingFlow: componentMocks.OnboardingFlow }));
const apiMocks = vi.hoisted(() => ({ serverApiFetch: vi.fn() }));
const orgMocks = vi.hoisted(() => ({ loadOrgContext: vi.fn() }));
vi.mock("./apiServer", () => apiMocks);
vi.mock("./currentOrg", () => orgMocks);

import AppLayout from "../app/(app)/layout";
import OnboardingPage from "../app/(app)/onboarding/page";
import LoginPage from "../app/(auth)/login/page";
import JoinPage from "../app/join/[token]/page";

function expectUnavailable(element: unknown) {
  expect(element).toMatchObject({ type: componentMocks.AuthUnavailable });
}

describe("auth route states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationMocks.redirect.mockImplementation((path: string) => {
      throw new Error(`redirect:${path}`);
    });
  });

  it("shows a recoverable state across protected, onboarding, invitation, and login routes", async () => {
    authMocks.loadServerAuth.mockResolvedValue({ status: "unavailable" });

    expectUnavailable(await AppLayout({ children: null, settings: null }));
    expectUnavailable(await OnboardingPage({ searchParams: Promise.resolve({}) }));
    expectUnavailable(await LoginPage({ searchParams: Promise.resolve({}) }));
    expectUnavailable(await JoinPage({ params: Promise.resolve({ token: "invite-token" }) }));
    expect(navigationMocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects to login only for an authoritative unauthenticated state", async () => {
    authMocks.loadServerAuth.mockResolvedValue({ status: "unauthenticated" });

    await expect(AppLayout({ children: null, settings: null })).rejects.toThrow("redirect:/login");
    await expect(OnboardingPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login");
    await expect(JoinPage({ params: Promise.resolve({ token: "invite-token" }) })).rejects.toThrow(
      "redirect:/login?next=%2Fjoin%2Finvite-token",
    );
    expect(navigationMocks.redirect).toHaveBeenCalledTimes(3);
  });

  it("reopens only the agent step for an onboarded member with a workspace", async () => {
    authMocks.loadServerAuth.mockResolvedValue({
      status: "authenticated",
      user: { userId: "u1", email: "alex@acme.test", name: "Alex", onboarded: true },
    });
    orgMocks.loadOrgContext.mockResolvedValue({ orgs: [], current: { id: "org-1", name: "Acme" } });

    const element = await OnboardingPage({ searchParams: Promise.resolve({ step: "agent" }) });

    expect(element).toMatchObject({
      type: componentMocks.OnboardingFlow,
      props: { initialStep: "agent", workspace: { id: "org-1", name: "Acme" } },
    });
    await expect(OnboardingPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/skills");
    orgMocks.loadOrgContext.mockResolvedValue({ orgs: [], current: null });
    await expect(OnboardingPage({ searchParams: Promise.resolve({ step: "agent" }) })).rejects.toThrow(
      "redirect:/skills",
    );
  });

  it("starts a member who is not onboarded at the workspace step, whatever the URL says", async () => {
    authMocks.loadServerAuth.mockResolvedValue({
      status: "authenticated",
      user: { userId: "u1", email: "alex@acme.test", name: "Alex", onboarded: false },
    });
    apiMocks.serverApiFetch.mockResolvedValue({ email: "alex@acme.test", domain: "acme.test", is_personal: false, matched_orgs: [] });

    const element = await OnboardingPage({ searchParams: Promise.resolve({ step: "agent" }) });

    expect(element).toMatchObject({
      type: componentMocks.OnboardingFlow,
      props: expect.not.objectContaining({ initialStep: expect.anything() }),
    });
    expect(orgMocks.loadOrgContext).not.toHaveBeenCalled();
  });

  it("does not offer Google login while the API cannot verify an existing session", async () => {
    authMocks.loadServerAuth.mockResolvedValue({ status: "unavailable" });

    const result = await LoginPage({ searchParams: Promise.resolve({ next: "/skills" }) });

    expectUnavailable(result);
    expect(result).not.toMatchObject({ type: componentMocks.LoginForm });
  });
});
