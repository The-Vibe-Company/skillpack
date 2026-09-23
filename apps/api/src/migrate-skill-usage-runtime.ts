import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { createDatabase, schema } from "@skillpack/db";
import { migrateSkillUsageRuntime } from "./skillUsageMigration";

export async function runRuntimeMigration(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args, options: { org: { type: "string" }, actor: { type: "string" },
    origin: { type: "string" }, apply: { type: "boolean", default: false } } });
  if (!values.org || !values.actor || !values.origin) throw new Error("--org, --actor and --origin are required; omit --apply for dry-run");
  const databaseUrl = process.env.DATABASE_MIGRATION_URL;
  if (!databaseUrl) throw new Error("DATABASE_MIGRATION_URL is required");
  const client = postgres(databaseUrl, { max: 1 });
  const database = createDatabase(client);
  try {
    const [actor] = await database.select().from(schema.user).where(eq(schema.user.id, values.actor));
    if (!actor) throw new Error("migration actor does not exist");
    const result = await migrateSkillUsageRuntime({ database, actor, orgId: values.org,
      instanceUrl: values.origin, dryRun: !values.apply });
    console.log(JSON.stringify({ applied: values.apply, skills: result }, null, 2));
  } finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRuntimeMigration().catch(() => {
    // Database failures may contain payloads/credentials. Keep the command output non-sensitive.
    console.error("Runtime skill migration failed; check configuration, membership and source integrity. It is safe to rerun.");
    process.exitCode = 1;
  });
}
