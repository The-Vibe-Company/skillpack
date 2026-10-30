import { publicArdCatalog } from "@/lib/publicDiscoveryManifests";
import { requestOrigin } from "@/lib/requestOrigin";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return Response.json(publicArdCatalog(requestOrigin(request)), { headers: { "cache-control": "no-store" } });
}
