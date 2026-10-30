import { handlePublicMcpRequest, publicProtocolError } from "@/lib/publicMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handlePublicMcpRequest;

/** This stateless endpoint answers POST requests only; it does not offer a persistent SSE stream. */
export function GET() {
  const response = publicProtocolError(405, -32000, "Use POST for the public MCP endpoint.");
  response.headers.set("allow", "POST");
  return response;
}

export const DELETE = GET;
