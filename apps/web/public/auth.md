# Skillpack authentication

## Public content

Home, the blog, llms.txt, the sitemap, and agent discovery documents are public.
The read-only MCP endpoint `/mcp/public` and A2A endpoint `/a2a` require no credentials.
They expose published blog articles and explicitly listed public catalog skills only.
The public catalog remains unavailable when disabled by the instance operator.
Do not send cookies, API keys, or OAuth tokens to these anonymous endpoints.

## Workspace access

Sign in or create a workspace at `/login`.
The existing workspace MCP endpoint `/mcp` requires OAuth and acts within the
member's consented workspace and capabilities. Discover the existing authorization
server through `/.well-known/oauth-protected-resource` and
`/.well-known/oauth-authorization-server`. Follow the browser consent flow;
public content access does not grant workspace access.

The native CLI uses `skillpack auth login` and browser approval. For automation,
provide `SKILLPACK_API_KEY` through a private secret environment and set
`SKILLPACK_API_URL` for a self-hosted instance. Keys are never accepted in chat or
committed configuration. See the native CLI documentation:
https://github.com/The-Vibe-Company/skillpack/blob/main/docs/skillpack-cli.md
