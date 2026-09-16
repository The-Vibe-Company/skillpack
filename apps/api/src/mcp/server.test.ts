import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SkillDatabaseRuntime, SkillDatabaseStorage } from "@skillpack/core";
import type { McpConnection } from "@skillpack/core/services";
import { createSkillpackMcpServer } from "./server";

process.env.COMPANION_SECRETS_MASTER_KEY ??= Buffer.alloc(32, 9).toString("base64");

const connection: McpConnection = {
  actor: { id: "user-1", email: "member@example.test", name: "Member" },
  orgId: "11111111-1111-4111-8111-111111111111",
  clientId: "client-1",
};

const unusedRuntime: SkillDatabaseRuntime = {
  execute: () => Promise.reject(new Error("the skill database runtime must not be reached")),
};
const unusedStorage: SkillDatabaseStorage = {
  get: () => Promise.reject(new Error("skill database storage must not be reached")),
  put: () => Promise.reject(new Error("skill database storage must not be reached")),
  delete: () => Promise.reject(new Error("skill database storage must not be reached")),
};

let client: Client;

async function connectClient(): Promise<Client> {
  const server = createSkillpackMcpServer({
    connection,
    skillDatabaseRuntime: unusedRuntime,
    skillDatabaseStorage: unusedStorage,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const connected = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverTransport), connected.connect(clientTransport)]);
  return connected;
}

function text(result: CallToolResult): string {
  return result.content.map((entry) => (entry.type === "text" ? entry.text : "")).join("\n");
}

/** The JSON argument values an MCP tool call carries. */
type ToolCallValue = string | number | boolean | null | ToolCallValue[] | { [key: string]: ToolCallValue };
interface ToolCallArguments {
  [key: string]: ToolCallValue | undefined;
}

/** `callTool` widens its result for compatibility clients; this server only ever returns the modern shape. */
async function callTool(name: string, args: ToolCallArguments): Promise<CallToolResult> {
  // SAFETY: `Client.callTool` returns `CallToolResult` unless a legacy result schema is requested,
  // and this suite never requests one.
  return await client.callTool({ name, arguments: args }) as CallToolResult;
}

beforeEach(async () => {
  client = await connectClient();
});

afterEach(async () => {
  await client.close();
});

describe("Skillpack MCP tool surface", () => {
  it("exposes the whole Skills Hub: skills, versions, labels, secrets and Skill Databases", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    expect(names).toEqual([
      "labels_create",
      "labels_delete",
      "labels_list",
      "labels_rename",
      "labels_set_color",
      "labels_set_icon",
      "secret_grant_redeem",
      "secret_retrieval_grant",
      "secret_retrieval_preflight",
      "secrets_create",
      "secrets_delete",
      "secrets_get",
      "secrets_list",
      "secrets_rotate",
      "secrets_update",
      "skill_archive",
      "skill_clear_public_version",
      "skill_database_describe",
      "skill_database_execute",
      "skill_database_query",
      "skill_database_shares_get",
      "skill_database_shares_set",
      "skill_dependencies",
      "skill_file_read",
      "skill_files",
      "skill_get",
      "skill_install",
      "skill_label_assign",
      "skill_label_unassign",
      "skill_publish",
      "skill_rename",
      "skill_restore",
      "skill_secret_binding_remove",
      "skill_secret_binding_set",
      "skill_secret_configuration",
      "skill_secret_suggestion_accept",
      "skill_secret_suggestion_remove",
      "skill_secret_suggestion_set",
      "skill_set_public_version",
      "skill_share",
      "skill_share_plan",
      "skill_uninstall",
      "skill_versions",
      "skills_list",
      "workspace_info",
    ]);
  });

  it("documents archive as the delete, because Skillpack never hard-deletes a skill", async () => {
    const { tools } = await client.listTools();
    const archive = tools.find((tool) => tool.name === "skill_archive");
    const restore = tools.find((tool) => tool.name === "skill_restore");

    expect(archive?.description).toMatch(/how a skill is deleted/i);
    expect(archive?.description).toMatch(/skill_restore/);
    expect(restore?.description).toMatch(/restore/i);
    expect(tools.some((tool) => /delete/i.test(tool.name) && tool.name.startsWith("skill_"))).toBe(false);
  });

  it("never offers a workspace argument: the consented workspace is the only one a tool can reach", async () => {
    const { tools } = await client.listTools();

    // Guard the guard: an empty or missing schema would make the assertion below pass vacuously.
    const argumentNames = tools.flatMap((tool) => Object.keys(tool.inputSchema.properties ?? {}));
    expect(argumentNames.length).toBeGreaterThan(20);
    expect(argumentNames).toContain("slug");

    for (const tool of tools) {
      const properties = tool.inputSchema.properties ?? {};
      expect(Object.keys(properties)).not.toContain("workspace_id");
      expect(Object.keys(properties)).not.toContain("org_id");
    }
  });

  it("reports the connected workspace and member from the connection, not from the caller", async () => {
    const { tools } = await client.listTools();
    const workspace = tools.find((tool) => tool.name === "workspace_info");

    expect(workspace?.inputSchema.properties ?? {}).toEqual({});
  });

  it("rejects a publish whose SKILL.md names a different skill before touching storage", async () => {
    const result = await callTool("skill_publish", {
      slug: "release-notes",
      files: [
        {
          path: "SKILL.md",
          content: "---\nname: other-skill\ndescription: A different skill entirely.\n---\n\nBody.\n",
        },
      ],
      dry_run: true,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("but this publish targets");
    expect(text(result)).toContain("other-skill");
    expect(text(result)).toContain("release-notes");
  });

  it("rejects a publish that tries to escape the package root", async () => {
    const result = await callTool("skill_publish", {
      slug: "release-notes",
      files: [{ path: "../outside.md", content: "nope" }],
      dry_run: true,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("file path must not contain empty or relative segments");
  });

  it("rejects a publish that asks for both an exact version and a bump", async () => {
    const result = await callTool("skill_publish", {
      slug: "release-notes",
      files: [{ path: "SKILL.md", content: "---\nname: release-notes\ndescription: Notes.\n---\n\nBody.\n" }],
      version: "1.2.3",
      bump: "minor",
      dry_run: true,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("pass either version or bump, not both");
  });
});
