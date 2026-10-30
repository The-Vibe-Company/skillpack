import { publicMcpServerCard } from "@/lib/publicMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(publicMcpServerCard(), { headers: { "cache-control": "no-store" } });
}
