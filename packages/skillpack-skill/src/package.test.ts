import { describe, expect, it } from "vitest";
import { buildSkillpackSkillPrompts } from "./package";

describe("native Skillpack management prompts", () => {
  it("uses the native CLI and API-key flow for every generated prompt", () => {
    const prompts = buildSkillpackSkillPrompts("1.120.1");
    const text = Object.values(prompts).join("\n");

    expect(text).toContain("skillpack auth login --api-url {base}");
    expect(text).toContain("Keep it running while the human approves");
    expect(text).toContain("skillpack doctor --json");
    expect(text).toContain("historic thecompanion.sh origin");
    expect(text).toContain("SKILLPACK_API_KEY");
    expect(text).toContain("skillpack auth status --json");
    expect(text).toContain("skillpack setup --tools");
    expect(text).toContain("skillpack install skillpack --version 1.120.1");
    expect(text).toContain("--scope <scope> --tools <selected>");
    expect(text).toContain("--scope <existing-scope> --tools <existing-tools>");
    expect(text).toContain("--dry-run --json");
    expect(text).toContain("skillpack update --all --dry-run");
    expect(text).toContain("skillpack skills publish FOLDER --scope org");
    expect(text).toContain("skillpack api METHOD /v1/path --input FILE");
    expect(text).toContain("releases/download/runtime-v0.3.1/");
    expect(text).toContain("install.sh");
    expect(text).toContain("install.ps1");
    expect(text).toContain("SHA256SUMS");
    expect(text).not.toContain("--scope user --tools <selected>");
    expect(text).not.toContain("GET /v1/getting-started --input FILE");
    expect(text).not.toMatch(/Agent Auth|agent-cli|npx\b|python(?:3)?\b|bootstrap\.py|mint a PAT|paste (?:the )?(?:API )?key/i);
  });
});
