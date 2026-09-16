import { createHash } from "node:crypto";
import { z } from "zod";
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { withTenantContext, type Db } from "@skillpack/db";
import {
  acceptSkillSecretSuggestion,
  archiveSkill,
  assignLabel,
  assignPersonalLabel,
  buildSkillSharePlan,
  clearSkillPublicVersion,
  createLabel,
  createPersonalLabel,
  createSecret,
  createSecretRetrievalGrant,
  deleteLabel,
  deletePersonalLabel,
  deleteSecret,
  getDownloadVersion,
  getSecret,
  getSkillBySlug,
  getSkillDependencies,
  getSkillNamingPolicy,
  getSkillSecretConfiguration,
  installSkill,
  listLabels,
  listOrgs,
  listPersonalLabels,
  listSecrets,
  listSkills,
  listSkillVersions,
  preflightSecretRetrieval,
  redeemSecretRetrievalGrant,
  removeSkillSecretBinding,
  removeSkillSecretSuggestion,
  renameLabel,
  renamePersonalLabel,
  renameSkill,
  restoreSkill,
  rotateSecret,
  setLabelColor,
  setLabelIcon,
  setPersonalLabelColor,
  setPersonalLabelIcon,
  setSkillPublicVersion,
  setSkillSecretBinding,
  setSkillSecretSuggestion,
  shareSkill,
  unassignLabel,
  unassignPersonalLabel,
  uninstallSkill,
  updateSecret,
  type ActorContext,
  type McpConnection,
} from "@skillpack/core/services";
import {
  describeSkillDatabase,
  executeSkillDatabaseStatement,
  getSkillDatabaseShares,
  setSkillDatabaseShares,
  skillDatabasesEnabled,
  type SkillDatabaseRuntime,
  type SkillDatabaseStorage,
} from "@skillpack/core";
import {
  createSecretInputSchema,
  labelColorSchema,
  labelIconSchema,
  redeemSecretGrantInputSchema,
  rotateSecretInputSchema,
  secretRetrievalPreflightInputSchema,
  skillDatabaseSharesInputSchema,
  skillDatabaseStatementInputSchema,
  updateSecretInputSchema,
  type SkillDatabaseStatementInput,
  type UpdateSecretInput,
} from "@skillpack/contracts";
import { getSkillArchive, skillDatabaseKey } from "@skillpack/storage";
import { extractArchiveFileContent, extractArchiveFiles, tarGzToZip, toTar } from "@skillpack/skills";
import { putPublicSkillReleaseSnapshot } from "@skillpack/storage";
import { publishSkillFromFiles, type SkillPublishFile } from "../skillPublish";
import { parseSkillListQuery } from "../skillListQuery";

/**
 * The Skills Hub as an MCP server.
 *
 * Every tool runs as the member who consented to this connection, inside the one workspace they
 * chose — never a caller-supplied workspace — and calls the same `@skillpack/core` services the REST
 * routes call, so authorization, audit rows and tenancy behave identically on both surfaces. There
 * is no hard delete in Skillpack: `skill_archive` is the delete, and `skill_restore` undoes it.
 */
export interface McpServerDependencies {
  connection: McpConnection;
  skillDatabaseRuntime: SkillDatabaseRuntime;
  skillDatabaseStorage: SkillDatabaseStorage;
}

/** Tool results are JSON text: one readable payload the calling agent can parse or quote. */
function ok<T>(value: T): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value ?? null, null, 2) }] };
}

/** A refusal the connected member can act on. Secret values never reach this path. */
function failure(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** One tool's argument schema: a record of named zod validators, as the MCP SDK expects. */
type ToolArguments = Record<string, z.ZodTypeAny>;

const slugArgument = z.string().min(1).describe("Skill slug, for example `release-notes`.");
const labelScopeArgument = z
  .enum(["org", "personal"])
  .default("org")
  .describe("`org` for the shared folder tree, `personal` for the caller's own My Skills folders.");

export function createSkillpackMcpServer(dependencies: McpServerDependencies): McpServer {
  const { connection } = dependencies;
  const actor: ActorContext = connection.actor;
  const orgId = connection.orgId;

  const server = new McpServer(
    { name: "skillpack", version: "1" },
    {
      instructions:
        "Skillpack Skills Hub. Tools act as the connected member inside one workspace. Archive is "
        + "the delete: `skill_archive` hides a skill and `skill_restore` brings it back. Publish a "
        + "skill by sending its files; `SKILL.md` must declare the same name as the `slug` argument.",
    },
  );

  /** Run one service call inside this connection's tenant transaction. */
  function tenant<T>(run: (input: { actor: ActorContext; orgId: string; database: Db }) => Promise<T>): Promise<T> {
    return withTenantContext({ orgId, userId: actor.id }, (database) => run({ actor, orgId, database }));
  }

  // The SDK already turns a thrown error into an `isError` result carrying its message, and every
  // service error below is written for the member reading it, so handlers throw rather than wrap.
  function tool<Args extends ToolArguments>(
    name: string,
    description: string,
    inputSchema: Args,
    handler: ToolCallback<Args>,
  ): void {
    server.registerTool(name, { description, inputSchema }, handler);
  }

  async function runSkillDatabaseStatement(
    slug: string,
    mode: "read" | "write",
    statement: SkillDatabaseStatementInput,
  ): Promise<CallToolResult> {
    if (!skillDatabasesEnabled()) return failure("Skill Databases are not enabled on this instance");
    return ok(
      await executeSkillDatabaseStatement({
        actor,
        orgId,
        slug,
        statement,
        mode,
        runtime: dependencies.skillDatabaseRuntime,
        storage: dependencies.skillDatabaseStorage,
        storageKey: skillDatabaseKey,
      }),
    );
  }

  async function versionArchive(slug: string, version: string): Promise<Buffer> {
    const found = await tenant(({ database }) => getDownloadVersion({ actor, orgId, slug, version, database }));
    return getSkillArchive({ key: found.storagePath });
  }

  // ---------------------------------------------------------------- workspace

  tool(
    "workspace_info",
    "The workspace this connection acts in, the caller's role, and the workspace's skill-naming policy.",
    {},
    async () => {
      const orgs = await listOrgs(actor);
      const current = orgs.find((entry) => entry.org_id === orgId);
      const namingPolicy = await tenant(({ database }) => getSkillNamingPolicy({ actor, orgId, database }));
      return ok({
        workspace_id: orgId,
        name: current?.name ?? null,
        slug: current?.slug ?? null,
        role: current?.org_role ?? null,
        member: { id: actor.id, email: actor.email, name: actor.name },
        skill_naming_policy: namingPolicy,
      });
    },
  );

  // ------------------------------------------------------------- skills: read

  tool(
    "skills_list",
    "List skills in the workspace. `lib` selects the org library, the caller's My Skills, or everything they may reference.",
    {
      lib: z.enum(["org", "mine", "accessible"]).default("org"),
      label: z.string().optional().describe("Folder path such as `marketing/seo`; includes descendants."),
      nolabel: z.boolean().default(false).describe("Only skills filed under no folder."),
      installed: z.boolean().default(false).describe("Only skills the caller has reported installed."),
      archived: z.boolean().default(false).describe("Include archived skills."),
      query: z.string().optional().describe("Full-text search over slug, description, tools and body."),
    },
    async (args) => {
      const read = (name: string): string | undefined => {
        if (name === "lib") return args.lib;
        if (name === "label") return args.label;
        if (name === "nolabel") return args.nolabel ? "true" : undefined;
        if (name === "installed") return args.installed ? "true" : undefined;
        if (name === "archived") return args.archived ? "true" : undefined;
        if (name === "q") return args.query;
        return undefined;
      };
      const parsed = parseSkillListQuery(read);
      if (!parsed.labelValid) return failure(`invalid folder path: ${args.label}`);
      return ok(
        await tenant(({ database }) =>
          listSkills({
            actor,
            orgId,
            library: parsed.library,
            label: parsed.label,
            nolabel: parsed.nolabel,
            installedOnly: parsed.installedOnly,
            archived: parsed.archived,
            query: parsed.query,
            limit: parsed.limit,
            database,
          }),
        ),
      );
    },
  );

  tool("skill_get", "One skill's metadata, including archived skills.", { slug: slugArgument }, async (args) => {
    const row = await tenant(({ database }) => getSkillBySlug({ actor, orgId, slug: args.slug, database }));
    return row ? ok(row) : failure(`skill "${args.slug}" was not found`);
  });

  tool("skill_versions", "Every published version of a skill, newest first.", { slug: slugArgument }, async (args) =>
    ok(await tenant(({ database }) => listSkillVersions({ actor, orgId, slug: args.slug, database }))),
  );

  tool(
    "skill_dependencies",
    "The requires/used-by graph for a skill, optionally for a specific version.",
    { slug: slugArgument, version: z.string().optional() },
    async (args) =>
      ok(
        await tenant(({ database }) =>
          getSkillDependencies({ actor, orgId, slug: args.slug, version: args.version ?? null, database }),
        ),
      ),
  );

  tool(
    "skill_files",
    "List the files inside one published skill version.",
    { slug: slugArgument, version: z.string().min(1) },
    async (args) => {
      const { files } = await extractArchiveFiles(toTar(await versionArchive(args.slug, args.version)));
      return ok({ version: args.version, files });
    },
  );

  tool(
    "skill_file_read",
    "Read one text file from a published skill version.",
    { slug: slugArgument, version: z.string().min(1), path: z.string().min(1) },
    async (args) => {
      const file = await extractArchiveFileContent(toTar(await versionArchive(args.slug, args.version)), args.path);
      if (file.status !== "ok") return failure(file.message);
      return ok({ path: file.path, content_type: file.content_type, content: file.bytes.toString("utf8") });
    },
  );

  // ------------------------------------------------------------ skills: write

  tool(
    "skill_publish",
    "Publish a new version of a skill from its files. `SKILL.md` must declare the same name as `slug`. "
      + "Use `dry_run` to validate and see the dependency plan without publishing.",
    {
      slug: slugArgument,
      files: z
        .array(z.object({ path: z.string().min(1), content: z.string() }))
        .min(1)
        .describe("Package-relative POSIX paths and UTF-8 contents; must include `SKILL.md`."),
      version: z.string().optional().describe("Exact semver to publish. Mutually exclusive with `bump`."),
      bump: z.enum(["major", "minor", "patch"]).optional().describe("Increment from the latest version instead."),
      message: z.string().optional().describe("Changelog note stored with the version."),
      scope: z.enum(["personal", "org"]).optional().describe("Library for a brand-new skill; ignored on update."),
      labels: z.array(z.string()).optional().describe("Folder paths to file a brand-new skill under."),
      expect_skill_id: z.string().optional().describe("Bind the publish to this exact existing skill id."),
      dry_run: z.boolean().default(false),
    },
    async (args) => {
      const files: SkillPublishFile[] = args.files.map((file) => ({ path: file.path, content: file.content }));
      const outcome = await publishSkillFromFiles({
        actor,
        orgId,
        slug: args.slug,
        files,
        version: args.version,
        bump: args.bump,
        message: args.message,
        scope: args.scope,
        labels: args.labels,
        expectSkillId: args.expect_skill_id,
        dryRun: args.dry_run,
      });
      return outcome.ok ? ok(outcome) : failure(JSON.stringify(outcome, null, 2));
    },
  );

  tool(
    "skill_rename",
    "Rename a skill's slug and/or its title in place, without publishing a new version.",
    { slug: slugArgument, new_slug: z.string().min(1), title: z.string().optional() },
    async (args) =>
      ok(
        await tenant(({ database }) =>
          renameSkill({
            actor,
            orgId,
            slug: args.slug,
            newSlug: args.new_slug,
            title: args.title,
            database,
          }),
        ),
      ),
  );

  tool(
    "skill_archive",
    "Archive a skill. This is how a skill is deleted in Skillpack: it leaves the normal lists but "
      + "stays viewable, downloadable and restorable. Use `skill_restore` to undo.",
    { slug: slugArgument, reason: z.string().max(500).optional() },
    async (args) => {
      await tenant(({ database }) =>
        archiveSkill({ actor, orgId, slug: args.slug, reason: args.reason, database }),
      );
      return ok({ ok: true, slug: args.slug, archived: true });
    },
  );

  tool("skill_restore", "Restore an archived skill into the normal lists.", { slug: slugArgument }, async (args) => {
    await tenant(({ database }) => restoreSkill({ actor, orgId, slug: args.slug, database }));
    return ok({ ok: true, slug: args.slug, archived: false });
  });

  tool(
    "skill_share_plan",
    "Preview what sharing a personal skill into the organization library would move.",
    { slug: slugArgument },
    async (args) => ok(await tenant(({ database }) => buildSkillSharePlan({ actor, orgId, slug: args.slug, database }))),
  );

  tool(
    "skill_share",
    "Move one of the caller's personal skills into the organization library. There is no reverse transition.",
    { slug: slugArgument },
    async (args) => {
      const result = await tenant(({ database }) => shareSkill({ actor, orgId, slug: args.slug, database }));
      return ok({ ok: true, slug: args.slug, scope: result.scope, shared_dependencies: result.shared_dependencies });
    },
  );

  tool(
    "skill_set_public_version",
    "Publish one version of a skill for public installation. Only the current version may be released.",
    { slug: slugArgument, version: z.string().min(1) },
    async (args) => {
      const packageVersion = await tenant(({ database }) =>
        getDownloadVersion({ actor, orgId, slug: args.slug, version: args.version, forPublicRelease: true, database }),
      );
      if (!packageVersion.isCurrent) return failure("only the current skill version can be made public");
      const stored = await getSkillArchive({ key: packageVersion.storagePath });
      let publicZip: Buffer;
      try {
        publicZip = await tarGzToZip(stored);
      } catch {
        return failure(
          "the stored skill package is not safe for public installation; publish a corrected version first",
        );
      }
      const packageChecksum = `sha256:${createHash("sha256").update(publicZip).digest("hex")}`;
      await putPublicSkillReleaseSnapshot({ orgId, checksum: packageChecksum, body: publicZip });
      return ok(
        await tenant(({ database }) =>
          setSkillPublicVersion({
            actor,
            orgId,
            slug: args.slug,
            version: args.version,
            packageChecksum,
            packageSizeBytes: publicZip.length,
            expectedCurrentVersionId: packageVersion.versionId,
            database,
          }),
        ),
      );
    },
  );

  tool(
    "skill_clear_public_version",
    "Withdraw public package access for a skill. The share token and versions stay intact.",
    { slug: slugArgument },
    async (args) => ok(await tenant(({ database }) => clearSkillPublicVersion({ actor, orgId, slug: args.slug, database }))),
  );

  tool(
    "skill_install",
    "Record that the caller has installed a skill, optionally at a specific version.",
    { slug: slugArgument, version: z.string().optional(), agent: z.string().optional() },
    async (args) => {
      const result = await tenant(({ database }) =>
        installSkill({
          actor,
          orgId,
          slug: args.slug,
          version: args.version ?? null,
          agentLabel: args.agent ?? null,
          source: "agent",
          database,
        }),
      );
      return ok({
        ok: true,
        installed: true,
        status: result.status,
        installed_version: result.installedVersion,
        current_version: result.currentVersion,
      });
    },
  );

  tool("skill_uninstall", "Record that the caller no longer has a skill installed.", { slug: slugArgument }, async (args) => {
    await tenant(({ database }) => uninstallSkill({ actor, orgId, slug: args.slug, database }));
    return ok({ ok: true, installed: false, status: "none" });
  });

  // ----------------------------------------------------------------- labels

  tool(
    "labels_list",
    "The folder tree that organizes skills. Folders never change who can see a skill.",
    { scope: labelScopeArgument },
    async (args) =>
      ok(
        await tenant(({ database }) =>
          args.scope === "personal"
            ? listPersonalLabels({ actor, orgId, database })
            : listLabels({ actor, orgId, database }),
        ),
      ),
  );

  tool(
    "labels_create",
    "Create a folder path. Missing ancestors are created with it.",
    {
      scope: labelScopeArgument,
      path: z.string().min(1).describe("Slash-separated folder path, for example `marketing/seo`."),
      display_name: z.string().optional(),
      color: labelColorSchema.optional(),
      icon: labelIconSchema.optional(),
    },
    async (args) => {
      await tenant(({ database }) =>
        args.scope === "personal"
          ? createPersonalLabel({
            actor,
            orgId,
            path: args.path,
            displayName: args.display_name,
            color: args.color,
            icon: args.icon,
            database,
          })
          : createLabel({
            actor,
            orgId,
            path: args.path,
            displayName: args.display_name,
            color: args.color,
            icon: args.icon,
            database,
          }),
      );
      return ok({ ok: true, scope: args.scope, path: args.path });
    },
  );

  tool(
    "labels_rename",
    "Move a folder path and its whole subtree to a new path.",
    {
      scope: labelScopeArgument,
      from: z.string().min(1),
      to: z.string().min(1),
      display_name: z.string().optional(),
    },
    async (args) => {
      await tenant(({ database }) =>
        args.scope === "personal"
          ? renamePersonalLabel({
            actor,
            orgId,
            from: args.from,
            to: args.to,
            displayName: args.display_name,
            database,
          })
          : renameLabel({
            actor,
            orgId,
            from: args.from,
            to: args.to,
            displayName: args.display_name,
            database,
          }),
      );
      return ok({ ok: true, scope: args.scope, from: args.from, to: args.to });
    },
  );

  tool(
    "labels_set_color",
    "Set or clear a folder's color. Pass null to return to the inherited appearance.",
    { scope: labelScopeArgument, path: z.string().min(1), color: labelColorSchema },
    async (args) => {
      await tenant(({ database }) =>
        args.scope === "personal"
          ? setPersonalLabelColor({ actor, orgId, path: args.path, color: args.color, database })
          : setLabelColor({ actor, orgId, path: args.path, color: args.color, database }),
      );
      return ok({ ok: true, scope: args.scope, path: args.path });
    },
  );

  tool(
    "labels_set_icon",
    "Set or clear a folder's icon. Pass null to return to the default appearance.",
    { scope: labelScopeArgument, path: z.string().min(1), icon: labelIconSchema },
    async (args) => {
      await tenant(({ database }) =>
        args.scope === "personal"
          ? setPersonalLabelIcon({ actor, orgId, path: args.path, icon: args.icon, database })
          : setLabelIcon({ actor, orgId, path: args.path, icon: args.icon, database }),
      );
      return ok({ ok: true, scope: args.scope, path: args.path });
    },
  );

  tool(
    "labels_delete",
    "Delete a folder path and its whole subtree. The skills filed under it are not deleted.",
    { scope: labelScopeArgument, path: z.string().min(1) },
    async (args) => {
      await tenant(({ database }) =>
        args.scope === "personal"
          ? deletePersonalLabel({ actor, orgId, path: args.path, database })
          : deleteLabel({ actor, orgId, path: args.path, database }),
      );
      return ok({ ok: true, scope: args.scope, path: args.path });
    },
  );

  tool(
    "skill_label_assign",
    "File a skill under a folder path.",
    { scope: labelScopeArgument, slug: slugArgument, path: z.string().min(1) },
    async (args) => {
      await tenant(({ database }) =>
        args.scope === "personal"
          ? assignPersonalLabel({ actor, orgId, slug: args.slug, path: args.path, database })
          : assignLabel({ actor, orgId, slug: args.slug, path: args.path, database }),
      );
      return ok({ ok: true, scope: args.scope, slug: args.slug, path: args.path });
    },
  );

  tool(
    "skill_label_unassign",
    "Remove a folder path from a skill. The folder itself stays.",
    { scope: labelScopeArgument, slug: slugArgument, path: z.string().min(1) },
    async (args) => {
      await tenant(({ database }) =>
        args.scope === "personal"
          ? unassignPersonalLabel({ actor, orgId, slug: args.slug, path: args.path, database })
          : unassignLabel({ actor, orgId, slug: args.slug, path: args.path, database }),
      );
      return ok({ ok: true, scope: args.scope, slug: args.slug, path: args.path });
    },
  );

  // ---------------------------------------------------------------- secrets

  tool("secrets_list", "Secrets the caller can reach. Values are never returned.", {}, async () =>
    ok(await tenant(({ database }) => listSecrets({ actor, orgId, database }))),
  );

  tool("secrets_get", "One secret's metadata. The value is never returned.", { secret_id: z.string().min(1) }, async (args) =>
    ok(await tenant(({ database }) => getSecret({ actor, orgId, secretId: args.secret_id, database }))),
  );

  tool(
    "secrets_create",
    "Create a write-only secret. The value is envelope-encrypted and can never be read back directly.",
    {
      name: z.string().min(1),
      key: z.string().min(1).describe("Environment-variable style key, for example `STRIPE_API_KEY`."),
      value: z.string().min(1),
      audience: z.enum(["personal", "restricted", "organization"]).default("personal"),
      recipient_ids: z.array(z.string()).default([]).describe("Required for, and only valid for, `restricted`."),
    },
    async (args) => {
      const value = createSecretInputSchema.parse({
        name: args.name,
        key: args.key,
        value: args.value,
        audience: args.audience,
        recipient_ids: args.recipient_ids,
      });
      return ok(await tenant(({ database }) => createSecret({ actor, orgId, value, database })));
    },
  );

  tool(
    "secrets_update",
    "Change a secret's name, key or audience. Use `secrets_rotate` to change the value.",
    {
      secret_id: z.string().min(1),
      name: z.string().optional(),
      key: z.string().optional(),
      audience: z.enum(["personal", "restricted", "organization"]).optional(),
      recipient_ids: z.array(z.string()).optional(),
    },
    async (args) => {
      const value = updateSecretInputSchema.parse(definedSecretUpdate(args));
      return ok(await tenant(({ database }) => updateSecret({ actor, orgId, secretId: args.secret_id, value, database })));
    },
  );

  tool(
    "secrets_rotate",
    "Replace a secret's value with a new version. Previous versions stay unreadable.",
    { secret_id: z.string().min(1), value: z.string().min(1) },
    async (args) => {
      const parsed = rotateSecretInputSchema.parse({ value: args.value });
      return ok(
        await tenant(({ database }) =>
          rotateSecret({ actor, orgId, secretId: args.secret_id, value: parsed.value, database }),
        ),
      );
    },
  );

  tool("secrets_delete", "Delete a secret and every binding that referenced it.", { secret_id: z.string().min(1) }, async (args) => {
    await tenant(({ database }) => deleteSecret({ actor, orgId, secretId: args.secret_id, database }));
    return ok({ ok: true, secret_id: args.secret_id });
  });

  tool(
    "skill_secret_configuration",
    "The secret slots a skill declares, with what each one is currently bound or suggested to.",
    { slug: slugArgument, version: z.string().optional() },
    async (args) =>
      ok(
        await tenant(({ database }) =>
          getSkillSecretConfiguration({ actor, orgId, slug: args.slug, version: args.version, database }),
        ),
      ),
  );

  tool(
    "skill_secret_binding_set",
    "Bind one of the caller's reachable secrets to a skill's secret slot.",
    { slug: slugArgument, slot_id: z.string().min(1), secret_id: z.string().min(1) },
    async (args) =>
      ok(
        await tenant(({ database }) =>
          setSkillSecretBinding({
            actor,
            orgId,
            slug: args.slug,
            slotId: args.slot_id,
            secretId: args.secret_id,
            database,
          }),
        ),
      ),
  );

  tool(
    "skill_secret_binding_remove",
    "Remove the caller's binding for one of a skill's secret slots.",
    { slug: slugArgument, slot_id: z.string().min(1) },
    async (args) =>
      ok(
        await tenant(({ database }) =>
          removeSkillSecretBinding({ actor, orgId, slug: args.slug, slotId: args.slot_id, database }),
        ),
      ),
  );

  tool(
    "skill_secret_suggestion_set",
    "Suggest a secret for a skill's slot so other members can accept it for themselves.",
    { slug: slugArgument, slot_id: z.string().min(1), secret_id: z.string().min(1) },
    async (args) =>
      ok(
        await tenant(({ database }) =>
          setSkillSecretSuggestion({
            actor,
            orgId,
            slug: args.slug,
            slotId: args.slot_id,
            secretId: args.secret_id,
            database,
          }),
        ),
      ),
  );

  tool(
    "skill_secret_suggestion_remove",
    "Withdraw the suggestion on one of a skill's secret slots.",
    { slug: slugArgument, slot_id: z.string().min(1) },
    async (args) =>
      ok(
        await tenant(({ database }) =>
          removeSkillSecretSuggestion({ actor, orgId, slug: args.slug, slotId: args.slot_id, database }),
        ),
      ),
  );

  tool(
    "skill_secret_suggestion_accept",
    "Accept the suggested secret for a skill slot as the caller's own binding.",
    { slug: slugArgument, slot_id: z.string().min(1) },
    async (args) =>
      ok(
        await tenant(({ database }) =>
          acceptSkillSecretSuggestion({ actor, orgId, slug: args.slug, slotId: args.slot_id, database }),
        ),
      ),
  );

  tool(
    "secret_retrieval_preflight",
    "Step 1 of retrieval: plan which secret values a run needs and report what is missing. No values.",
    {
      operation_id: z.string().min(1).describe("Caller-chosen UUID identifying this run."),
      skills: z
        .array(z.object({ slug: z.string().min(1), version: z.string().optional() }))
        .default([]),
      direct: z
        .array(z.object({ secret_id: z.string().min(1), env_key: z.string().min(1), profile: z.string().min(1) }))
        .default([]),
    },
    async (args) => {
      const value = secretRetrievalPreflightInput(args);
      return ok(await tenant(({ database }) => preflightSecretRetrieval({ actor, orgId, value, database })));
    },
  );

  tool(
    "secret_retrieval_grant",
    "Step 2 of retrieval: mint a single-use grant for a plan produced by `secret_retrieval_preflight`.",
    { plan_id: z.string().min(1) },
    async (args) =>
      ok(await tenant(({ database }) => createSecretRetrievalGrant({ actor, orgId, planId: args.plan_id, database }))),
  );

  tool(
    "secret_grant_redeem",
    "Step 3 of retrieval: redeem a grant once for the plaintext values it authorizes.",
    { grant: z.string().min(1) },
    async (args) => {
      const parsed = redeemSecretGrantInputSchema.parse({ grant: args.grant });
      const result = await tenant(({ database }) =>
        redeemSecretRetrievalGrant({ actor, orgId, grant: parsed.grant, database }),
      );
      return result.ok ? ok(result.value) : failure(result.error);
    },
  );

  // -------------------------------------------------------- skill databases

  tool(
    "skill_database_describe",
    "The declared schema and current state of a skill's database.",
    { slug: slugArgument },
    async (args) => {
      if (!skillDatabasesEnabled()) return failure("Skill Databases are not enabled on this instance");
      return ok(await tenant(({ database }) => describeSkillDatabase({ actor, orgId, slug: args.slug, database })));
    },
  );

  tool(
    "skill_database_query",
    "Run one read-only statement against a skill's database.",
    {
      slug: slugArgument,
      sql: z.string().min(1),
      params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).default([]),
      audience: z.enum(["organization", "personal"]).default("organization"),
      realm_id: z.string().optional().describe("A personal realm shared with the caller."),
    },
    async (args) =>
      runSkillDatabaseStatement(
        args.slug,
        "read",
        skillDatabaseStatementInputSchema.parse({
          sql: args.sql,
          params: args.params,
          audience: args.audience,
          realm_id: args.realm_id,
        }),
      ),
  );

  tool(
    "skill_database_execute",
    "Run one writing statement against a skill's database.",
    {
      slug: slugArgument,
      sql: z.string().min(1),
      params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).default([]),
      audience: z.enum(["organization", "personal"]).default("organization"),
      realm_id: z.string().optional().describe("A personal realm shared with the caller."),
    },
    async (args) =>
      runSkillDatabaseStatement(
        args.slug,
        "write",
        skillDatabaseStatementInputSchema.parse({
          sql: args.sql,
          params: args.params,
          audience: args.audience,
          realm_id: args.realm_id,
        }),
      ),
  );

  tool(
    "skill_database_shares_get",
    "Who the caller's personal realm of a skill database is shared with.",
    { slug: slugArgument },
    async (args) => {
      if (!skillDatabasesEnabled()) return failure("Skill Databases are not enabled on this instance");
      return ok(await tenant(({ database }) => getSkillDatabaseShares({ actor, orgId, slug: args.slug, database })));
    },
  );

  tool(
    "skill_database_shares_set",
    "Replace the member list the caller's personal realm of a skill database is shared with.",
    { slug: slugArgument, user_ids: z.array(z.string()) },
    async (args) => {
      if (!skillDatabasesEnabled()) return failure("Skill Databases are not enabled on this instance");
      const input = skillDatabaseSharesInputSchema.parse({ user_ids: args.user_ids });
      return ok(
        await tenant(({ database }) =>
          setSkillDatabaseShares({
            actor,
            orgId,
            slug: args.slug,
            userIds: input.user_ids,
            storageKey: skillDatabaseKey,
            database,
          }),
        ),
      );
    },
  );

  return server;
}

/**
 * Only the fields the caller actually sent. `updateSecretInputSchema` requires at least one, so an
 * omitted field must be absent rather than present-and-undefined.
 */
function definedSecretUpdate(args: {
  name?: string;
  key?: string;
  audience?: "personal" | "restricted" | "organization";
  recipient_ids?: string[];
}): Partial<UpdateSecretInput> {
  const update: Partial<UpdateSecretInput> = {};
  if (args.name !== undefined) update.name = args.name;
  if (args.key !== undefined) update.key = args.key;
  if (args.audience !== undefined) update.audience = args.audience;
  if (args.recipient_ids !== undefined) update.recipient_ids = args.recipient_ids;
  return update;
}

/** Narrow the preflight arguments through the shared contract before they reach Core. */
function secretRetrievalPreflightInput(args: {
  operation_id: string;
  skills: { slug: string; version?: string }[];
  direct: { secret_id: string; env_key: string; profile: string }[];
}) {
  return secretRetrievalPreflightInputSchema.parse({
    operation_id: args.operation_id,
    skills: args.skills.map((entry) => ({ slug: entry.slug, version: entry.version })),
    direct: args.direct,
  });
}
