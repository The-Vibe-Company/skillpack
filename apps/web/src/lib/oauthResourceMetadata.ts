import { z } from "zod";
import { requestOrigin } from "./requestOrigin";

const metadataSchema = z.object({
  authorization_servers: z.array(z.string().url()).min(1),
  // Better Auth's MCP discovery can omit these existing public OIDC scopes.
  scopes_supported: z.array(z.string().min(1)).default(["openid", "profile", "email", "offline_access"]),
}).passthrough();

/** Adapt only resource discovery metadata; Better Auth remains the authorization server. */
export async function oauthResourceMetadata(request: Request, resourcePath: "" | "/mcp") {
  const api = process.env.COMPANION_API_URL ?? "http://127.0.0.1:3001";
  try {
    const upstream = await fetch(new URL("/auth/.well-known/oauth-protected-resource", api), {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok) throw new Error("Metadata unavailable");
    const metadata = metadataSchema.parse(await upstream.json());
    return Response.json({ ...metadata, resource: `${requestOrigin(request)}${resourcePath}` }, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Protected resource metadata unavailable" }, { status: 502 });
  }
}
