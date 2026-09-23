import type { Hono } from "hono";
import { createHash } from "node:crypto";
import { z } from "zod";
import { issueApiToken, listOrgs } from "@skillpack/core/services";
import { sql, withTenantContext } from "@skillpack/db";
import { actorFromContext, isAgentRequest, isTokenRequest, jsonError, type ApiVariables } from "./context";

type ApiApp = Hono<{ Variables: ApiVariables }>;
const requestId = z.string().regex(/^[a-f0-9]{64}$/);
const verifier = z.string().regex(/^[a-f0-9]{64}$/);
const startInput = z.object({ request_id: requestId, verifier_hash: verifier }).strict();
const pollInput = z.object({ request_id: requestId, verifier }).strict();
const decisionInput = z.object({ request_id: requestId, decision: z.enum(["approve", "deny"]), workspace_id: z.string().uuid().optional() }).strict();
const lifetimeSeconds = 300;

const pendingSchema = z.object({ hash: verifier, status: z.enum(["pending", "approved", "denied"]), actor: z.object({ id: z.string(), email: z.string(), name: z.string() }).optional(), workspaceId: z.string().optional() });
type Pending = z.infer<typeof pendingSchema>;
function key(id: string): string { return `cli-login:${id}`; }

/** A browser-visible ID is never enough to redeem a token. The CLI keeps a separate 256-bit verifier. */
export function registerCliLoginRoutes(app: ApiApp): void {
  app.post("/v1/cli-login/start", async (c) => {
    try {
      const input = startInput.parse(await c.req.json());
      await sql`delete from agent_auth_ephemeral where key like 'cli-login:%' and expires_at <= now()`;
      const bucket = Math.floor(Date.now() / 60_000);
      const counter = await sql<{ value: string }[]>`
        insert into agent_auth_ephemeral (key, value, expires_at, updated_at)
        values (${`cli-login:start:${bucket}`}, '1', now() + interval '60 seconds', now())
        on conflict (key) do update set value = ((agent_auth_ephemeral.value)::integer + 1)::text,
          updated_at = now()
        returning value
      `;
      if (Number(counter[0]?.value ?? "0") > 1_000) {
        return jsonError(c, "too many authorization requests; try again shortly", 429);
      }
      const value: Pending = { hash: input.verifier_hash, status: "pending" };
      const rows = await sql<{ key: string }[]>`
        insert into agent_auth_ephemeral (key, value, expires_at, updated_at)
        values (${key(input.request_id)}, ${JSON.stringify(value)}, now() + (${lifetimeSeconds} * interval '1 second'), now())
        on conflict (key) do nothing returning key
      `;
      if (!rows[0]) return jsonError(c, "authorization request already exists", 409);
      const web = process.env.COMPANION_WEB_URL ?? "http://127.0.0.1:3000";
      const url = new URL("/cli/approve", web);
      url.searchParams.set("request_id", input.request_id);
      c.header("Cache-Control", "no-store");
      return c.json({ verification_uri: url.toString(), expires_in: lifetimeSeconds, interval: 2 });
    } catch (error) { return jsonError(c, error); }
  });

  app.get("/v1/cli-login/request", async (c) => {
    try {
      if (isTokenRequest(c) || isAgentRequest(c)) return jsonError(c, "browser session required", 403);
      const actor = actorFromContext(c);
      const id = requestId.parse(c.req.query("request_id"));
      const rows = await sql<{ value: string }[]>`select value from agent_auth_ephemeral where key = ${key(id)} and expires_at > now()`;
      if (!rows[0]) return jsonError(c, "authorization request expired", 404);
      const pending = pendingSchema.parse(JSON.parse(rows[0].value));
      if (pending.status !== "pending") return jsonError(c, "authorization request already decided", 409);
      const workspaces = await listOrgs(actor);
      c.header("Cache-Control", "no-store");
      return c.json({ workspaces: workspaces.map((org) => ({ id: org.org_id, name: org.name })), expires_in: lifetimeSeconds });
    } catch (error) { return jsonError(c, error, 401); }
  });

  app.post("/v1/cli-login/decision", async (c) => {
    try {
      const expectedOrigin = new URL(process.env.COMPANION_WEB_URL ?? "http://127.0.0.1:3000").origin;
      if (c.req.header("origin") !== expectedOrigin) return jsonError(c, "invalid approval origin", 403);
      if (isTokenRequest(c) || isAgentRequest(c)) return jsonError(c, "browser session required", 403);
      const actor = actorFromContext(c);
      const input = decisionInput.parse(await c.req.json());
      if (input.decision === "approve") {
        const workspaces = await listOrgs(actor);
        if (!input.workspace_id || !workspaces.some((org) => org.org_id === input.workspace_id)) {
          return jsonError(c, "select a workspace you belong to", 403);
        }
      }
      const rows = await sql<{ value: string }[]>`
        update agent_auth_ephemeral
        set value = jsonb_set(jsonb_set(jsonb_set(value::jsonb,
          '{status}', to_jsonb(${input.decision === "approve" ? "approved" : "denied"}::text)),
          '{actor}', ${JSON.stringify(actor)}::jsonb),
          '{workspaceId}', to_jsonb(${input.workspace_id ?? ""}::text))::text,
          updated_at = now()
        where key = ${key(input.request_id)} and expires_at > now()
          and value::jsonb ->> 'status' = 'pending'
        returning value
      `;
      if (!rows[0]) return jsonError(c, "authorization request expired or already decided", 409);
      c.header("Cache-Control", "no-store");
      return c.json({ status: input.decision === "approve" ? "approved" : "denied" });
    } catch (error) { return jsonError(c, error); }
  });

  app.post("/v1/cli-login/poll", async (c) => {
    try {
      const input = pollInput.parse(await c.req.json());
      const hash = createHash("sha256").update(input.verifier).digest("hex");
      const rows = await sql<{ value: string }[]>`
        select value from agent_auth_ephemeral
        where key = ${key(input.request_id)} and expires_at > now()
          and value::jsonb ->> 'hash' = ${hash}
      `;
      if (!rows[0]) return jsonError(c, "authorization request expired", 404);
      const pending = pendingSchema.parse(JSON.parse(rows[0].value));
      if (pending.status === "pending") return c.json({ status: "pending" }, 202);
      const consumed = await sql<{ value: string }[]>`
        delete from agent_auth_ephemeral
        where key = ${key(input.request_id)} and expires_at > now()
          and value::jsonb ->> 'hash' = ${hash}
          and value::jsonb ->> 'status' = ${pending.status}
        returning value
      `;
      if (!consumed[0]) return jsonError(c, "authorization request already consumed", 409);
      if (pending.status === "denied") return c.json({ status: "denied" }, 403);
      if (!pending.actor || !pending.workspaceId) return jsonError(c, "authorization request incomplete", 409);
      const issued = await withTenantContext({ orgId: pending.workspaceId, userId: pending.actor.id }, (database) =>
        issueApiToken({ actor: pending.actor!, orgId: pending.workspaceId!, name: "Skillpack CLI", database }),
      );
      c.header("Cache-Control", "no-store");
      return c.json({ status: "approved", token: issued.token });
    } catch (error) { return jsonError(c, error); }
  });
}
