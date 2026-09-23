// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CliApproval, type CliApprovalApi } from "./CliApproval";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });

describe("CLI browser approval", () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); });

  it("shows workspace and broad key access before the user approves", async () => {
    const id = "a".repeat(64);
    const decisions: Array<[string, string, string | undefined]> = [];
    const api: CliApprovalApi = {
      async load() { return { workspaces: [{ id: "11111111-1111-4111-8111-111111111111", name: "Example workspace" }] }; },
      async decide(requestId, decision, workspaceId) { decisions.push([requestId, decision, workspaceId]); },
    };
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root!.render(React.createElement(CliApproval, { requestId: id, api })));
    expect(host.textContent).toContain("Example workspace");
    expect(host.textContent).toContain("secrets");
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("Approve CLI access"));
    await act(async () => button?.click());
    expect(decisions).toEqual([[id, "approve", "11111111-1111-4111-8111-111111111111"]]);
    expect(host.textContent).toContain("Return to your terminal");
    expect(host.textContent).not.toContain("cmp_pat_");
  });
});
