import { publicA2aAgentCard } from "@/lib/publicMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(publicA2aAgentCard(), { headers: { "cache-control": "no-store" } });
}
