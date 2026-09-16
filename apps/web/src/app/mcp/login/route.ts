import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Where Better Auth sends an unauthenticated MCP authorization request.
 *
 * The plugin appends the whole authorize query to this URL, so it cannot be `/login?next=…`
 * directly: this route re-frames that query as a `next` target and sends the member through the
 * normal sign-in screen. It also clears the plugin's `oidc_login_prompt` resume cookie — that cookie
 * makes Better Auth answer the *sign-in* request with an OAuth redirect, which the web app's JSON
 * sign-in proxy would read as a failed login. Returning through `next` is the deterministic path.
 */
export function GET(request: NextRequest): NextResponse {
  const query = request.nextUrl.search.replace(/^\?/, "");
  const authorize = query ? `/auth/mcp/authorize?${query}` : "/auth/mcp/authorize";
  // A relative Location keeps the browser on the exact host it arrived on. Rebuilding an absolute
  // URL from the request origin can switch `127.0.0.1` to `localhost`, which would drop the session
  // cookie the authorize endpoint is about to read.
  const response = new NextResponse(null, {
    status: 302,
    headers: { location: `/login?next=${encodeURIComponent(authorize)}` },
  });
  response.cookies.set({ name: "oidc_login_prompt", value: "", path: "/", maxAge: 0 });
  return response;
}
