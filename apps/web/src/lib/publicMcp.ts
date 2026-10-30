import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SUPPORTED_PROTOCOL_VERSIONS, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { publicCatalogPathSchema } from "@skillpack/contracts";
import { z } from "zod";
import { blogPostPath, findBlogPost, loadBlogPosts } from "./blog";
import { fetchPublicCatalogSearch, fetchPublicCatalogSkill, isPublicCatalogEnabled } from "./publicCatalog";
import { resolveSiteUrl } from "./siteUrl";

export const PUBLIC_MCP_PATH = "/mcp/public";
export const PUBLIC_A2A_PATH = "/a2a";
export const PUBLIC_PROTOCOL_BODY_LIMIT = 16 * 1024;
export const PUBLIC_SERVER_INFO = { name: "app.skillpack/public", version: "1.0.0" } as const;

/** Deployment discovery must connect to this preview while SEO retains its canonical origin. */
export function publicProtocolSiteUrl(): URL {
  const previewHost = process.env.VERCEL_URL;
  if (process.env.VERCEL_ENV === "preview" && previewHost && /^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/i.test(previewHost)) {
    return new URL(`https://${previewHost}`);
  }
  return resolveSiteUrl();
}

const pagination = {
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).max(10_000).default(0),
};
const searchInput = z.object({ query: z.string().trim().max(256).optional(), ...pagination }).strict();
const skillInput = publicCatalogPathSchema.strict();
const articleListInput = z.object(pagination).strict();
const articleInput = z.object({ slug: z.string().max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }).strict();

export const PUBLIC_TOOL_DESCRIPTIONS = {
  search_skills: "Read one page of the anonymous public skill catalog. Query filters this page by name, slug or description; follow next_offset to continue searching subsequent pages. Catalog availability is controlled by the instance.",
  read_skill: "Read the validated, published catalog snapshot for an organization and skill slug, including its SKILL.md body. Only explicitly listed public organization skills are available.",
  list_articles: "List published Skillpack blog articles, newest first, with bounded pagination. Use read_article to read an article's complete Markdown body.",
  read_article: "Read one published Skillpack blog article by slug, including its complete Markdown body.",
} as const;

export const PUBLIC_TOOL_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
type PublicToolName = keyof typeof PUBLIC_TOOL_DESCRIPTIONS;
type PublicToolArguments = z.input<typeof searchInput> | z.input<typeof skillInput> | z.input<typeof articleListInput> | z.input<typeof articleInput>;
const publicToolNames: PublicToolName[] = ["search_skills", "read_skill", "list_articles", "read_article"];

function success<T>(value: T): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Shared read-only dispatch. No request, identity, headers, cookies or keys enter this boundary. */
export async function callPublicTool(name: string, input: PublicToolArguments): Promise<CallToolResult> {
  try {
    switch (name) {
      case "search_skills": {
        const parsed = searchInput.safeParse(input);
        if (!parsed.success) return failure("Invalid tool arguments.");
        if (!isPublicCatalogEnabled()) return failure("The public catalog is unavailable.");
        const result = await fetchPublicCatalogSearch(parsed.data);
        return result ? success(result) : failure("The public catalog is unavailable.");
      }
      case "read_skill": {
        const parsed = skillInput.safeParse(input);
        if (!parsed.success) return failure("Invalid tool arguments.");
        if (!isPublicCatalogEnabled()) return failure("The public catalog is unavailable.");
        const result = await fetchPublicCatalogSkill(parsed.data.orgSlug, parsed.data.skillSlug);
        return result ? success(result) : failure("Public skill not found.");
      }
      case "list_articles": {
        const parsed = articleListInput.safeParse(input);
        if (!parsed.success) return failure("Invalid tool arguments.");
        const { limit, offset } = parsed.data;
        const posts = loadBlogPosts();
        return success({
          articles: posts.slice(offset, offset + limit).map(({ body: _body, ...post }) => ({ ...post, path: blogPostPath(post.slug) })),
          next_offset: offset + limit < posts.length && offset + limit <= 10_000 ? offset + limit : null,
        });
      }
      case "read_article": {
        const parsed = articleInput.safeParse(input);
        if (!parsed.success) return failure("Invalid tool arguments.");
        const post = findBlogPost(parsed.data.slug);
        return post ? success({ ...post, path: blogPostPath(post.slug) }) : failure("Public article not found.");
      }
      default:
        return failure("Unknown public tool.");
    }
  } catch {
    // API failures, storage paths and malformed source content must not leak to anonymous callers.
    return failure("Public content is temporarily unavailable.");
  }
}

function createPublicMcpServer(): McpServer {
  const server = new McpServer(PUBLIC_SERVER_INFO);
  const schemas = {
    search_skills: searchInput,
    read_skill: skillInput,
    list_articles: articleListInput,
    read_article: articleInput,
  };
  for (const name of publicToolNames) {
    server.registerTool(name, {
      description: PUBLIC_TOOL_DESCRIPTIONS[name],
      inputSchema: schemas[name],
      annotations: PUBLIC_TOOL_ANNOTATIONS,
    }, async (args: PublicToolArguments) => callPublicTool(name, args));
  }
  return server;
}

/** Native clients omit Origin; browser clients must use the configured public instance origin. */
export function isPublicProtocolOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === publicProtocolSiteUrl().origin;
}

export function publicProtocolError(status: number, code: number, message: string, id: string | number | null = null): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}

/** One server and stateless SDK transport per request; no sessions or authenticated MCP proxy. */
export async function handlePublicMcpRequest(request: Request): Promise<Response> {
  if (!isPublicProtocolOriginAllowed(request)) return publicProtocolError(403, -32000, "Origin not allowed.");
  const server = createPublicMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: PUBLIC_PROTOCOL_BODY_LIMIT,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch {
    return publicProtocolError(500, -32603, "Public protocol request failed.");
  } finally {
    await server.close();
  }
}

export function publicMcpServerCard() {
  const siteUrl = publicProtocolSiteUrl();
  return {
    // Server Cards remain experimental. Standard identity/remotes plus scanner compatibility data.
    $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    ...PUBLIC_SERVER_INFO,
    title: "Skillpack public content",
    description: "Read published Skillpack articles and explicitly listed public skills.",
    websiteUrl: siteUrl.href,
    remotes: [{ type: "streamable-http", url: new URL(PUBLIC_MCP_PATH, siteUrl).href, supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS }],
    serverInfo: PUBLIC_SERVER_INFO,
    capabilities: { tools: {} },
    tools: Object.entries(PUBLIC_TOOL_DESCRIPTIONS).map(([name, description]) => ({ name, description, annotations: PUBLIC_TOOL_ANNOTATIONS })),
  };
}

export function publicA2aAgentCard() {
  return {
    protocolVersion: "0.3.0",
    name: "Skillpack public content",
    description: "Read-only public catalog and published articles. Send one JSON command as a text part: {\"tool\":\"list_articles\",\"arguments\":{}}. Queries use the documented MCP tool arguments; no natural-language execution, private libraries, task storage or streaming.",
    url: new URL(PUBLIC_A2A_PATH, publicProtocolSiteUrl()).href,
    preferredTransport: "JSONRPC",
    version: PUBLIC_SERVER_INFO.version,
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: Object.entries(PUBLIC_TOOL_DESCRIPTIONS).map(([id, description]) => ({
      id,
      name: id,
      description,
      tags: ["public", "read-only", id.includes("article") ? "articles" : "skills"],
      examples: [JSON.stringify({ tool: id, arguments: id === "read_skill" ? { orgSlug: "acme", skillSlug: "release-helper" } : id === "read_article" ? { slug: "agent-skills-vs-mcp" } : {} })],
    })),
    supportsAuthenticatedExtendedCard: false,
  };
}

const a2aRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.unknown().optional(),
});
const a2aMessageSchema = z.object({
  message: z.object({
    kind: z.literal("message"),
    role: z.literal("user"),
    messageId: z.string().min(1).max(256),
    parts: z.array(z.object({ kind: z.literal("text"), text: z.string().min(1) })).length(1),
    // This adapter only answers fresh messages; it never claims to resume a stored task/context.
    taskId: z.never().optional(),
    contextId: z.never().optional(),
  }),
  configuration: z.object({
    acceptedOutputModes: z.array(z.string()).optional(),
    pushNotificationConfig: z.never().optional(),
  }).optional(),
});
const publicCommandSchema = z.object({
  tool: z.enum(["search_skills", "read_skill", "list_articles", "read_article"]),
  arguments: z.union([searchInput, skillInput, articleListInput, articleInput]).prefault({}),
}).strict();

/** Bounded reader for the small, non-streaming A2A message adapter. */
async function readPublicProtocolBody(request: Request): Promise<string | null> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > PUBLIC_PROTOCOL_BODY_LIMIT) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PUBLIC_PROTOCOL_BODY_LIMIT) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** A2A 0.3 message/send returns an immediate Message; no tasks, writes or model execution. */
export async function handlePublicA2aRequest(request: Request): Promise<Response> {
  if (!isPublicProtocolOriginAllowed(request)) return publicProtocolError(403, -32000, "Origin not allowed.");
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return publicProtocolError(415, -32600, "Content-Type must be application/json.");
  }
  let body: unknown;
  try {
    const source = await readPublicProtocolBody(request);
    if (source === null) return publicProtocolError(413, -32600, "Request body is too large.");
    body = JSON.parse(source);
  } catch {
    return publicProtocolError(400, -32700, "Invalid JSON.");
  }
  const rpc = a2aRequestSchema.safeParse(body);
  if (!rpc.success) return publicProtocolError(400, -32600, "Invalid request.");
  const { id, method, params } = rpc.data;
  if (method === "tasks/get" || method === "tasks/cancel") {
    const task = z.object({ id: z.string().min(1).max(256) }).safeParse(params);
    if (!task.success) return publicProtocolError(200, -32602, "A task id is required.", id);
    // Synchronous messages never create stored tasks; every task lookup is therefore absent.
    return publicProtocolError(200, -32001, "Task not found.", id);
  }
  if (method !== "message/send") return publicProtocolError(200, -32601, "Method not found.", id);
  const message = a2aMessageSchema.safeParse(params);
  if (!message.success) return publicProtocolError(200, -32602, "Send one text command in a new user message.", id);
  const modes = message.data.configuration?.acceptedOutputModes;
  if (modes && !modes.includes("text/plain")) return publicProtocolError(200, -32005, "Only text/plain output is available.", id);
  let command: z.infer<typeof publicCommandSchema>;
  try {
    command = publicCommandSchema.parse(JSON.parse(message.data.message.parts[0]!.text));
  } catch {
    return publicProtocolError(200, -32602, "Send a JSON command with a public tool and arguments.", id);
  }
  const result = await callPublicTool(command.tool, command.arguments);
  return Response.json({
    jsonrpc: "2.0", id,
    result: {
      kind: "message", role: "agent", messageId: crypto.randomUUID(),
      parts: result.content.filter((part) => part.type === "text").map((part) => ({ kind: "text", text: part.text })),
      metadata: { isError: result.isError ?? false },
    },
  }, { headers: { "cache-control": "no-store" } });
}
