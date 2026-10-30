import { z } from "zod";
import { oauthResourceMetadata } from "@/lib/oauthResourceMetadata";
import { requestOrigin } from "@/lib/requestOrigin";

export const dynamic = "force-dynamic";
const issuerMetadata = z.object({ authorization_servers: z.array(z.string().url()).min(1) });

export async function GET(request: Request) {
  const metadata = await oauthResourceMetadata(request, "");
  if (!metadata.ok) return metadata;
  const { authorization_servers } = issuerMetadata.parse(await metadata.json());
  // Poppy 0.3's website-only profile uses ordinary signed-out browsing. Do not claim
  // Poppy sessions, API token support, conversations or sign-in extensions we do not implement.
  return Response.json({
    protocol_version: "0.3",
    organization: { name: "Skillpack", domain: new URL(requestOrigin(request)).hostname },
    auth: { issuer: authorization_servers[0] },
    web: {},
  }, { headers: { "cache-control": "no-store" } });
}
