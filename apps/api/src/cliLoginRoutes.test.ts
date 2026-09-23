import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { registerCliLoginRoutes } from "./cliLoginRoutes";
import type { ApiVariables } from "./context";

function app() {
  const instance = new Hono<{ Variables: ApiVariables }>();
  instance.use("*", async (c, next) => {
    c.set("user", null);
    c.set("programmaticAuthKind", null);
    await next();
  });
  registerCliLoginRoutes(instance);
  return instance;
}

describe("CLI login boundary", () => {
  it("rejects malformed public requests before creating state", async () => {
    const response = await app().request("/v1/cli-login/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request_id: "short", verifier_hash: "a".repeat(64) }) });
    expect(response.status).toBe(400);
  });

  it("requires a browser session to view or decide on a request", async () => {
    const id = "a".repeat(64);
    const get = await app().request(`/v1/cli-login/request?request_id=${id}`);
    expect(get.status).toBe(401);
    const post = await app().request("/v1/cli-login/decision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request_id: id, decision: "approve", workspace_id: "11111111-1111-4111-8111-111111111111" }) });
    expect(post.status).toBe(403);
  });
});
