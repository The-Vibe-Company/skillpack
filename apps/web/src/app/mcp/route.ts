import { requestOrigin } from "@/lib/requestOrigin";

export const dynamic = "force-dynamic";

function endToEndHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const token of (headers.get("connection") ?? "").split(",")) {
    if (token.trim()) headers.delete(token.trim());
  }
  for (const name of ["host", "connection", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]) headers.delete(name);
  return headers;
}

/** Relay the existing MCP transport unchanged, adapting only its 401 discovery metadata. */
async function proxy(request: Request) {
  const api = process.env.COMPANION_API_URL ?? "http://127.0.0.1:3001";
  const target = new URL("/mcp", api);
  target.search = new URL(request.url).search;
  const headersToForward = endToEndHeaders(request.headers);
  // Fetch decodes compressed bodies; request identity so relayed bytes and lengths stay intact.
  headersToForward.set("accept-encoding", "identity");
  const forwarded = new Request(new Request(target, request), { headers: headersToForward });
  const upstream = await fetch(forwarded, { cache: "no-store", redirect: "manual" });
  const headers = endToEndHeaders(upstream.headers);
  if (upstream.status === 401) {
    headers.set("WWW-Authenticate", `Bearer resource_metadata="${requestOrigin(request)}/.well-known/oauth-protected-resource/mcp"`);
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}

export { proxy as GET, proxy as HEAD, proxy as POST, proxy as DELETE, proxy as OPTIONS, proxy as PUT, proxy as PATCH };
