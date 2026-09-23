import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LocalSkillRow } from "@skillpack/contracts";
import type { SkillVM } from "@/lib/types";
import { DetailMoreMenuContent, DetailView } from "./DetailView";
import { LocalSkillDrawer, LocalSkillsView } from "./LocalSkillsView";
import { InstallDialog, UploadDialog } from "./UploadDialog";
import { SKILL_ACTIONS } from "./skillActions";

// oxlint-disable-next-line anti-slop/no-module-mocking -- the App Router seam is replaced while rendering the real update dialogs.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
}));

const skill: SkillVM = {
  uuid: "skill-1",
  id: "research-agent",
  shareToken: "share-research-agent",
  version: "1.2.3",
  validation: "valid",
  description: "Research helper.",
  icon: null,
  notes: null,
  error: null,
  scope: "org",
  source: null,
  labels: [],
  authorId: "user-1",
  authorName: "Alice Nardon",
  authorInitials: "AN",
  authorAvatarUrl: null,
  updaterId: "user-1",
  updaterName: "Alice Nardon",
  updaterInitials: "AN",
  updaterAvatarUrl: null,
  modifiers: [],
  tools: ["read_file"],
  requirements: [],
  size: "1 KB",
  license: "MIT",
  checksum: "sha256:abc",
  created: "2026-06-09",
  updated: "just now",
  installStatus: "none",
  installedVersion: null,
  requiresCount: 0,
  usedByCount: 0,
  depWarn: false,
  archived: false,
  compatibility: null,
  metadata: {
    companion_skill_id: "skill-1",
    companion_version: "1.2.3",
  },
};

function localSkill(status: LocalSkillRow["status"], overrides: Partial<LocalSkillRow> = {}): LocalSkillRow {
  return {
    workspaceId: "org-1",
    key: "companion",
    name: "Skillpack",
    description: "Manage skills locally.",
    status,
    installedVersion: status === "none" ? null : "1.0.0",
    availableVersion: status === "update" ? "1.1.0" : "1.0.0",
    lastReportedAt: null,
    agentLabel: null,
    notes: "A local helper skill.\n\n- Keeps local skills current.",
    commands: [],
    changes: ["Refreshes the bundled helper."],
    integrity: { packageChecksum: `sha256:${"a".repeat(64)}`, files: { "SKILL.md": `sha256:${"b".repeat(64)}` } },
    prompts: {
      install: "install {base} {workspaceId} {token}",
      update: "update {base} {workspaceId} {token}",
      use: "use {base} {workspaceId} {token}",
      onboarding: "onboard {base} {workspaceId} {tool}",
      resume: "resume {base} {workspaceId} {tool}",
    },
    ...overrides,
  };
}

describe("skill update flow", () => {
  it("removes the visible Update button from the skill detail topbar", () => {
    const html = renderToString(
      React.createElement(DetailView, {
        skill,
        index: 0,
        total: 1,
        me: { id: "user-1", name: "Alice Nardon", email: "alice@example.com", initials: "AN", avatarUrl: null },
        orgName: "The Vibe Company",
        allLabels: [],
        onBack: vi.fn(),
        onPrev: vi.fn(),
        onNext: vi.fn(),
        onToggleLabel: vi.fn(),
        onSelectLabel: vi.fn(),
        onAction: vi.fn(),
        onOpenSkill: vi.fn(),
      }),
    );

    expect(html).not.toContain(">Update<");
    expect(html).toContain('aria-label="More actions"');
  });

  it("shows publish in the More menu only for users who can modify the skill", () => {
    const editable = renderToString(
      React.createElement(DetailMoreMenuContent, {
        actions: [SKILL_ACTIONS.download, SKILL_ACTIONS.publishVersion, SKILL_ACTIONS.archive],
        onAction: vi.fn(),
      }),
    );
    const readOnly = renderToString(
      React.createElement(DetailMoreMenuContent, {
        actions: [SKILL_ACTIONS.download],
        onAction: vi.fn(),
      }),
    );

    expect(editable).toContain("Publish new version");
    expect(editable).toContain('aria-label="Archive skill"');
    expect(editable).toContain('title="Archive skill"');
    expect(editable).toMatch(/class="menu__label">Archive<\/span>/);
    expect(editable).not.toMatch(/class="menu__label">Archive skill<\/span>/);
    expect(readOnly).not.toContain("Publish new version");
    expect(readOnly).toContain("Download package");
  });

  it("renders update as assistant/package/browser flows without command-line copy", () => {
    const html = renderToString(
      React.createElement(UploadDialog, {
        mode: "update",
        workspaceId: "org-1",
        skill,
        onClose: vi.fn(),
        onPublished: vi.fn(),
      }),
    );

    expect(html).toContain("Use an AI assistant");
    expect(html).toContain("Upload package");
    expect(html).toContain("Create in browser");
    expect(html).toContain("Publish new version");
    expect(html).not.toContain("Update skill");
    expect(html).toContain("Browser reference validation endpoint");
    expect(html).toContain("Browser reference publish endpoint");
    expect(html).toContain("action=validate");
    expect(html).toContain("action=publish");
    expect(html).toContain("expect_slug=research-agent");
    expect(html).toContain("expect_skill_id=skill-1");
    expect(html).toContain("version=1.2.4");
    expect(html).toContain("metadata.companion_skill_id");
    expect(html).toContain("do not edit or publish the package");
    expect(html).toContain("it appears to be a different skill");
    expect(html).toContain("Never publish after failed validation or ambiguous identity");
    expect(html).toContain("native Skillpack CLI");
    expect(html).toContain("skillpack skills validate FOLDER --json");
    expect(html).toContain("SKILLPACK_API_KEY");
    expect(html).not.toContain("Agent Auth");
    expect(html).not.toContain("mint a PAT");
    expect(html).not.toContain("cmp_pat_");
    expect(html).not.toContain("Command line");
    expect(html).not.toContain("companion CLI");
  });

  it("tells an agent to keep the public release unless the user explicitly promotes", () => {
    const html = renderToString(
      React.createElement(UploadDialog, {
        mode: "update",
        workspaceId: "org-1",
        skill: { ...skill, publicVersion: "1.2.3", canManagePublic: true },
        onClose: vi.fn(),
        onPublished: vi.fn(),
      }),
    );
    expect(html).toContain("currently exposes public v1.2.3");
    expect(html).toContain("with &quot;no&quot; as the default");
    expect(html).toContain("never publish it again");
  });

  it("does not offer or instruct public promotion to a non-managing Developer", () => {
    const html = renderToString(
      React.createElement(UploadDialog, {
        mode: "update",
        workspaceId: "org-1",
        skill: { ...skill, publicVersion: "1.2.3", canManagePublic: false },
        onClose: vi.fn(),
        onPublished: vi.fn(),
      }),
    );
    expect(html).not.toContain("currently exposes public v1.2.3");
    expect(html).not.toContain("Replace the public release?");
    expect(html).not.toContain("/public-version");
  });

  it("uses Update skill only for installing the newest registry version", () => {
    const html = renderToString(
      React.createElement(InstallDialog, {
        skill: { ...skill, installStatus: "update", installedVersion: "1.1.0" },
        workspaceId: "org-1",
        onClose: vi.fn(),
        onReported: vi.fn(),
      }),
    );

    expect(html).toContain('aria-label="Update skill"');
    expect(html).toContain("Use an AI assistant");
    expect(html).toContain("Download package");
    expect(html).not.toContain("Publish new version");
    expect(html).toContain("skillpack install research-agent --version 1.2.3");
    expect(html).toContain("Workspace ID: org-1");
    expect(html).toContain("skillpack auth status --json");
    expect(html).toContain("SKILLPACK_API_KEY");
    expect(html).toContain("releases/download/runtime-v0.2.0/");
    expect(html).toContain("install.sh");
    expect(html).toContain("install.ps1");
    expect(html).toContain("SHA256SUMS");
    expect(html).not.toContain("secrets:read");
    expect(html).not.toContain("Agent Auth");
    expect(html).not.toContain("COMPANION_AUTH_MODE");
    expect(html).not.toContain("legacy-pat");
    expect(html).not.toContain("cmp_pat_");
    expect(html).not.toContain("Authorization: Bearer");
    expect(html).not.toContain("Bearer cmp_");
    expect(html).not.toContain("Access token");
  });

  it("renders create prompt with validation before publish", () => {
    const html = renderToString(
      React.createElement(UploadDialog, {
        workspaceId: "org-1",
        onClose: vi.fn(),
        onPublished: vi.fn(),
      }),
    );

    expect(html).toContain("Browser reference validation endpoint");
    expect(html).toContain("Browser reference publish endpoint");
    expect(html).toContain("action=validate");
    expect(html).toContain("action=publish");
    expect(html).toContain("expect_slug=URL_ENCODED_SKILL_SLUG");
    expect(html).toContain("version=1.0.0");
    expect(html).toContain("replace URL_ENCODED_SKILL_SLUG in both endpoints");
    expect(html).toContain("Never send the placeholder");
    expect(html).toContain("skillpack skills validate FOLDER --json");
    expect(html).toContain("Never publish after failed validation");
  });

  it("shows reinstall only beside the local skill update prompt", () => {
    const update = renderToString(
      React.createElement(LocalSkillDrawer, {
        skill: localSkill("update"),
        workspaceId: "org-1",
        onClose: vi.fn(),
      }),
    );
    const installed = renderToString(
      React.createElement(LocalSkillDrawer, {
        skill: localSkill("installed"),
        workspaceId: "org-1",
        onClose: vi.fn(),
      }),
    );
    const fresh = renderToString(
      React.createElement(LocalSkillDrawer, {
        skill: localSkill("none"),
        workspaceId: "org-1",
        onClose: vi.fn(),
      }),
    );

    expect(update).toContain("Copy update prompt");
    expect(update).toContain("Reinstall Skill?");
    expect(installed).not.toContain("Reinstall Skill?");
    expect(fresh).toContain("Copy install prompt");
    expect(fresh).not.toContain("Reinstall Skill?");
  });

  it("uses the canonical companion local skill instead of the first row", () => {
    const html = renderToString(
      React.createElement(LocalSkillsView, {
        workspaceId: "org-1",
        workspaceName: "Acme",
        skills: [
          localSkill("none", { key: "other-helper", name: "Other helper", description: "Wrong row." }),
          localSkill("installed"),
        ],
      }),
    );

    expect(html).toContain("Skillpack");
    expect(html).toContain("companion");
    expect(html).not.toContain("Other helper");
    expect(html).not.toContain("other-helper");
  });
});
