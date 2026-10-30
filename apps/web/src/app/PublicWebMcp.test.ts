// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicWebMcp } from "./PublicWebMcp";

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("root WebMCP registration", () => {
  it.each(["document", "navigator", "absent"])("feature-detects the %s API and cleans up on unmount", async (target) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const registerTool = vi.fn();
    const unregisterTool = vi.fn();
    const context = { registerTool, unregisterTool };
    if (target === "document") document.modelContext = context;
    if (target === "navigator") navigator.modelContext = context;
    try {
      await act(async () => { root.render(React.createElement(PublicWebMcp)); });
      expect(registerTool).toHaveBeenCalledTimes(target === "absent" ? 0 : 4);
      expect(container.innerHTML).toBe("");
      await act(async () => { root.unmount(); });
      expect(unregisterTool).toHaveBeenCalledTimes(target === "absent" ? 0 : 4);
    } finally {
      delete document.modelContext;
      delete navigator.modelContext;
    }
  });
});
