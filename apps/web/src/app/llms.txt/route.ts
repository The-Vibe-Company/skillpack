import { homeMarkdown, markdownResponse } from "@/lib/agentMarkdown";

export const dynamic = "force-static";

export function GET() {
  return markdownResponse(homeMarkdown());
}
