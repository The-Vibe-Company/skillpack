import { z } from "zod";

const metadataSchema = z.object({ issuer: z.string().url(), poppy_domains: z.array(z.string().min(1)).optional() }).passthrough();

/** Add Poppy's public domain binding without changing issuer, endpoints or OAuth behavior. */
export async function oauthAuthorizationMetadata() {
  const api = process.env.COMPANION_API_URL ?? "http://127.0.0.1:3001";
  try {
    const upstream = await fetch(new URL("/auth/.well-known/oauth-authorization-server", api), {
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok) throw new Error("Metadata unavailable");
    const metadata = metadataSchema.parse(await upstream.json());
    return Response.json({ ...metadata, poppy_domains: [...new Set([...(metadata.poppy_domains ?? []), new URL(metadata.issuer).hostname])] }, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Authorization server metadata unavailable" }, { status: 502 });
  }
}
