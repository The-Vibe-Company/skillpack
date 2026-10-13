import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CATALOG_REPO_ROOT,
  CATALOG_SOURCES,
  catalogSkillPath,
  findCatalogSkill,
  loadCatalogSkill,
  loadCatalogSkills,
  runtimeRelease,
} from "./catalog";

const USAGE_BLOCK = [
  "<!-- skillpack:usage:start -->",
  "## Skillpack runtime",
  "",
  "Usage is observed locally by skillpack-runtime when installed through Skillpack.",
  "<!-- skillpack:usage:end -->",
].join("\n");

const tempDirs: string[] = [];

function repoWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "skillpack-catalog-"));
  tempDirs.push(root);
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}

function skillMd(name: string, body = "\n# Title\n\nBody.\n"): string {
  return `---\nname: ${name}\ndescription: Does one thing.\nlicense: MIT\n---\n${body}`;
}

afterEach(() => {
  tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("official catalog sources", () => {
  it("lists only the bundled management skill and the repository example skill", () => {
    expect(CATALOG_SOURCES).toEqual([
      { dir: "packages/skillpack-skill/skill", install: "management" },
      { dir: "examples/skills/incident-summary", install: "source" },
    ]);
    expect(loadCatalogSkills().map((skill) => skill.slug)).toEqual(["skillpack", "incident-summary"]);
  });

  it("reads frontmatter facts, the package file list and the GitHub source folder", () => {
    const management = findCatalogSkill("skillpack");
    expect(management).toMatchObject({
      slug: "skillpack",
      license: "MIT",
      compatibility: "claude-code codex opencode grok-bot openclaw hermes companion",
      allowedTools: "read_file write_file run_shell",
      install: "management",
      sourceUrl: "https://github.com/The-Vibe-Company/skillpack/tree/main/packages/skillpack-skill/skill",
    });
    expect(management?.files).toEqual(expect.arrayContaining(["SKILL.md", "companion.json", "reference/api.md"]));
    expect(management?.body).toMatch(/^# Skillpack\n/);

    expect(findCatalogSkill("incident-summary")).toMatchObject({
      description: "Summarize an incident timeline from logs into a concise postmortem draft.",
      license: "MIT",
      compatibility: undefined,
      allowedTools: "read_file run_python",
      files: ["SKILL.md", "companion.json", "scripts/summarize.py"],
      install: "source",
      sourceUrl: "https://github.com/The-Vibe-Company/skillpack/tree/main/examples/skills/incident-summary",
    });
    expect(findCatalogSkill("no-such-skill")).toBeUndefined();
    expect(catalogSkillPath("incident-summary")).toBe("/catalog/incident-summary");
  });

  it("links the runtime release the management skill pins", () => {
    const pinned = readFileSync(join(CATALOG_REPO_ROOT, "packages/skillpack-skill/skill/runtime-release.json"), "utf8");
    const { version } = runtimeRelease();

    expect(pinned).toContain(`"version": "${version}"`);
    expect(runtimeRelease()).toEqual({
      version,
      url: `https://github.com/The-Vibe-Company/skillpack/releases/tag/runtime-v${version}`,
    });
    const broken = repoWith({ "packages/skillpack-skill/skill/runtime-release.json": '{"version": "latest"}' });
    expect(() => runtimeRelease(broken)).toThrow("invalid runtime version");
  });

  it("ships every source folder with the web build", () => {
    // turbo prune leaves these folders out of the Railway image, and Next traces only listed files.
    const dockerfile = readFileSync(join(CATALOG_REPO_ROOT, "deploy/railway/Dockerfile.web"), "utf8");
    const nextConfig = readFileSync(join(CATALOG_REPO_ROOT, "apps/web/next.config.ts"), "utf8");
    const turbo = readFileSync(join(CATALOG_REPO_ROOT, "apps/web/turbo.json"), "utf8");
    for (const { dir } of CATALOG_SOURCES) {
      expect(dockerfile).toContain(`COPY --from=pruner /app/${dir} ./${dir}\n`);
      expect(nextConfig).toContain(`"../../${dir}/**/*"`);
      expect(turbo).toContain(`"$TURBO_ROOT$/${dir}/**"`);
    }
  });
});

describe("catalog skill loading", () => {
  it("strips a generated skillpack:usage block, markers and content, from the body", () => {
    const root = repoWith({ "skills/demo/SKILL.md": skillMd("demo", `\n${USAGE_BLOCK}\n\n# Demo\n\nBody.\n`) });
    const skill = loadCatalogSkill({ dir: "skills/demo", install: "source" }, root);

    expect(skill.body).toBe("# Demo\n\nBody.\n");
    expect(skill.body).not.toContain("skillpack:usage");
    expect(skill.body).not.toContain("Skillpack runtime");
  });

  it("keeps marker examples the author wrote inside the body", () => {
    const example = "```html\n<!-- skillpack:usage:start -->example<!-- skillpack:usage:end -->\n```\n";
    const root = repoWith({ "skills/demo/SKILL.md": skillMd("demo", `\n# Demo\n\n${example}`) });

    expect(loadCatalogSkill({ dir: "skills/demo", install: "source" }, root).body).toContain(example);
  });

  it("lists nested files by name and leaves packaging junk out", () => {
    const root = repoWith({
      "skills/demo/SKILL.md": skillMd("demo"),
      "skills/demo/scripts/run.py": "print('hi')\n",
      "skills/demo/scripts/__pycache__/run.cpython-312.pyc": "",
      "skills/demo/.DS_Store": "",
    });

    expect(loadCatalogSkill({ dir: "skills/demo", install: "source" }, root).files).toEqual([
      "SKILL.md",
      "scripts/run.py",
    ]);
  });

  it("fails the build for invalid frontmatter, an unclosed usage block, a misused install kind or a duplicate", () => {
    const root = repoWith({
      "skills/bad/SKILL.md": "# No frontmatter\n",
      "skills/unclosed/SKILL.md": skillMd("unclosed", "\n<!-- skillpack:usage:start -->\noops\n"),
      "skills/demo/SKILL.md": skillMd("demo"),
      "skills/copy/SKILL.md": skillMd("demo"),
    });

    expect(() => loadCatalogSkill({ dir: "skills/bad", install: "source" }, root)).toThrow(/^skills\/bad: /);
    expect(() => loadCatalogSkill({ dir: "skills/unclosed", install: "source" }, root)).toThrow("Unclosed");
    expect(() => loadCatalogSkill({ dir: "skills/demo", install: "management" }, root)).toThrow(/management/);
    expect(() =>
      loadCatalogSkills(
        [
          { dir: "skills/demo", install: "source" },
          { dir: "skills/copy", install: "source" },
        ],
        root,
      ),
    ).toThrow('duplicate skill "demo"');
  });
});
