import { handlePublicA2aRequest } from "@/lib/publicMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handlePublicA2aRequest;
