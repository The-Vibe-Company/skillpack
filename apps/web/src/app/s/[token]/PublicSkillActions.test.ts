// @vitest-environment happy-dom

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPublicInstallPrompt, PublicSkillActions } from "./PublicSkillActions";

// SAFETY: happy-dom reads this documented React test flag from the global object; no external payload is narrowed here.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const release = {
  version: "2.3.4",
  checksum: `sha256:${"a".repeat(64)}`,
  size_bytes: 4096,
  released_at: "2026-07-21T10:00:00.000Z",
};

describe("buildPublicInstallPrompt", () => {
  it("pins the API-key scope, exact release, and root-only native install", () => {
    const prompt = buildPublicInstallPrompt({
      origin: "https://companion.example",
      token: "public-token",
      slug: "release-helper",
      release,
    });
    expect(prompt).toContain("skillpack auth login --api-url https://companion.example/v1");
    expect(prompt).toContain("skillpack auth status --json");
    expect(prompt).toContain("SKILLPACK_API_KEY");
    expect(prompt).toContain("skillpack install --public public-token --version 2.3.4 --scope project");
    expect(prompt).toContain("--scope user");
    expect(prompt).toContain("root-only");
    expect(prompt).toContain("does not");
    expect(prompt).toContain("resolve dependencies, retrieve secrets, or submit an install report");
    expect(prompt).toContain("public-skills:install");
    expect(prompt).toContain("release-helper@2.3.4");
    expect(prompt).toContain("public-token");
    expect(prompt).toContain(release.checksum);
    expect(prompt).toContain("4096 bytes");
    expect(prompt).toContain("Let the native CLI verify the server metadata and package digest");
    expect(prompt).toContain("Claude Code, Codex, OpenCode, Grok Bot, OpenClaw, or Hermes");
    expect(prompt).not.toContain("@auth/agent-cli");
    expect(prompt).not.toContain("npx ");
    expect(prompt).not.toContain("Agent Auth");
    expect(prompt).not.toContain("mint a PAT");
    expect(prompt).toContain("Hermes is global-only");
    expect(prompt).toContain("releases/download/runtime-v0.2.0/");
    expect(prompt).toContain("install.sh");
    expect(prompt).toContain("install.ps1");
    expect(prompt).toContain("SHA256SUMS");
  });
});

describe("PublicSkillActions", () => {
  let root: Root;
  let host: HTMLDivElement;
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("copies an autonomous prompt and exposes a session download", async () => {
    await act(async () => {
      root.render(React.createElement(PublicSkillActions, {
        token: "public-token",
        slug: "release-helper",
        release,
        authenticated: true,
      }));
    });
    const copy = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Copy install prompt"));
    await act(async () => copy?.click());
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0]?.[0]).toContain("release-helper@2.3.4");
    const download = host.querySelector<HTMLAnchorElement>('a[download]');
    expect(download?.getAttribute("href")).toBe("/v1/public/skills/public-token/versions/2.3.4/package");
  });

  it("returns signed-out users to the same public page before downloading", async () => {
    await act(async () => {
      root.render(React.createElement(PublicSkillActions, {
        token: "public-token",
        slug: "release-helper",
        release,
        authenticated: false,
      }));
    });
    const signIn = [...host.querySelectorAll("a")].find((anchor) => anchor.textContent?.includes("Sign in to download"));
    expect(signIn?.getAttribute("href")).toContain("%2Fs%2Fpublic-token%3Fdownload%3D1");
  });

  it("does not offer package actions for a metadata-only link", async () => {
    await act(async () => {
      root.render(React.createElement(PublicSkillActions, {
        token: "public-token",
        slug: "release-helper",
        release: null,
        authenticated: false,
      }));
    });
    expect(host.textContent).toContain("No public release");
    expect(host.querySelector('a[download]')).toBeNull();
    expect(host.textContent).not.toContain("Copy install prompt");
  });
});
