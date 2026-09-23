import { describe, expect, it } from "vitest";
import { fillPrompt } from "./prompts";

describe("skill prompt filling", () => {
  it("fills public placeholders without ever injecting the token placeholder", () => {
    const prompt = fillPrompt(
      "use {base} in {workspaceId} with {tool} and {token}",
      "https://skillpack.example/v1",
      "workspace-1",
      "Codex",
      "Codex",
    );

    expect(prompt).toContain("https://skillpack.example/v1");
    expect(prompt).toContain("workspace-1");
    expect(prompt).toContain("Codex");
    expect(prompt).toContain("SKILLPACK_API_KEY");
    expect(prompt).not.toContain("{token}");
    expect(prompt).not.toMatch(/cmp_[A-Za-z0-9]|Agent Auth|mint a PAT/i);
  });
});
