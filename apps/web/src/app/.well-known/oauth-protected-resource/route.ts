import { oauthResourceMetadata } from "@/lib/oauthResourceMetadata";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return oauthResourceMetadata(request, "");
}
