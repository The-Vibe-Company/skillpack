import { z } from "zod";

type ToolSchema = {
  type: "object";
  properties: Record<string, { type: string; description?: string; minimum?: number; maximum?: number; maxLength?: number; pattern?: string }>;
  required?: string[];
  additionalProperties: false;
};
export interface PublicWebMcpInput {
  query?: string;
  limit?: number;
  offset?: number;
  orgSlug?: string;
  skillSlug?: string;
  slug?: string;
}
export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: ToolSchema;
  annotations: { readOnlyHint: true; untrustedContentHint: true; consequentialHint: false };
  execute: (input: PublicWebMcpInput, options?: { signal: AbortSignal }) => Promise<PublicToolResult>;
}
export interface WebModelContext {
  registerTool: (tool: WebMcpTool, options?: { signal: AbortSignal }) => void | Promise<void>;
  unregisterTool?: (name: string) => void;
}

declare global {
  interface Navigator { modelContext?: WebModelContext }
  interface Document { modelContext?: WebModelContext }
}

const resultSchema = z.object({
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
  isError: z.boolean().optional(),
});
type PublicToolResult = z.infer<typeof resultSchema>;
const responseSchema = z.object({ result: resultSchema });
const pagination = {
  limit: { type: "integer", minimum: 1, maximum: 50 },
  offset: { type: "integer", minimum: 0, maximum: 10_000 },
};
const publicSlug = { type: "string", maxLength: 128, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" };
const definitions: { name: string; method: string; description: string; inputSchema: ToolSchema }[] = [
  {
    name: "search_skills", method: "search_skills",
    description: "Search one page of explicitly listed public skills. Follow next_offset for more results. The instance may disable its public catalog.",
    inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 256 }, ...pagination }, additionalProperties: false },
  },
  {
    name: "get_skill", method: "read_skill",
    description: "Read one explicitly listed public skill by organization and skill slug. Private libraries are unavailable.",
    inputSchema: { type: "object", properties: { orgSlug: publicSlug, skillSlug: publicSlug }, required: ["orgSlug", "skillSlug"], additionalProperties: false },
  },
  {
    name: "list_blog_posts", method: "list_articles", description: "List published Skillpack blog posts with bounded pagination.",
    inputSchema: { type: "object", properties: pagination, additionalProperties: false },
  },
  {
    name: "read_blog_post", method: "read_article", description: "Read the complete Markdown of one published Skillpack blog post by slug.",
    inputSchema: { type: "object", properties: { slug: publicSlug }, required: ["slug"], additionalProperties: false },
  },
];

function unavailable(): PublicToolResult {
  return { isError: true, content: [{ type: "text", text: "Public content is temporarily unavailable." }] };
}

/** All browser tools use the anonymous transport; browser identity and page contents stay out. */
export function publicWebMcpTools(): WebMcpTool[] {
  return definitions.map(({ name, method, description, inputSchema }) => ({
    name, description, inputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
    execute: async (input, options) => {
      try {
        const response = await fetch("/mcp/public", {
          method: "POST", credentials: "omit", redirect: "error", signal: options?.signal,
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: method, arguments: input } }),
        });
        if (!response.ok) return unavailable();
        const parsed = responseSchema.safeParse(await response.json());
        return parsed.success ? parsed.data.result : unavailable();
      } catch {
        return unavailable();
      }
    },
  }));
}

/** Supports the current Document API and early Navigator implementations. */
export function registerPublicWebMcpTools(context?: WebModelContext): () => void {
  if (!context?.registerTool) return () => {};
  const controller = new AbortController();
  const owned = new Set<string>();
  for (const tool of publicWebMcpTools()) {
    try {
      const registration = context.registerTool(tool, { signal: controller.signal });
      if (registration === undefined) owned.add(tool.name);
      else void registration.then(() => {
        if (controller.signal.aborted) context.unregisterTool?.(tool.name);
        else owned.add(tool.name);
      }).catch(() => {});
    } catch {
      // An unavailable experimental API must not break ordinary browsing.
    }
  }
  return () => {
    controller.abort();
    for (const name of owned) {
      try { context.unregisterTool?.(name); } catch { /* The browser may already have removed it. */ }
    }
  };
}
