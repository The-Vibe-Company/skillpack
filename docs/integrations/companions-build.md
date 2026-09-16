# companions.build MCP connection

companions.build reaches the Skills Hub through Skillpack's MCP server. A Companion gets the full
tool surface — skills, versions and files, folders, secrets and Skill Databases — acting as the
member who connected it, inside the one workspace that member picked. There is no personal access
token to mint, no shared client secret to distribute, and no per-capability device approval.

## What Skillpack exposes

| Purpose | URL |
| --- | --- |
| MCP resource | `${PUBLIC_URL}/mcp` |
| Protected-resource metadata | `${PUBLIC_URL}/auth/.well-known/oauth-protected-resource` |
| Authorization-server metadata | `${PUBLIC_URL}/auth/.well-known/oauth-authorization-server` |
| Authorize | `${PUBLIC_URL}/auth/mcp/authorize` |
| Token | `${PUBLIC_URL}/auth/mcp/token` |
| Dynamic client registration | `${PUBLIC_URL}/auth/mcp/register` |

Both `.well-known` documents are also served from the origin root, so an MCP client that performs
RFC 8414 discovery against the issuer finds them.

Scopes are `openid` and `offline_access`; `offline_access` is what makes the token endpoint return a
refresh token. Access tokens last one hour, refresh tokens thirty days. PKCE S256 is required and
clients register with `token_endpoint_auth_method: "none"`.

Skillpack forces `prompt=consent` on every authorization request, so a client cannot skip the
consent screen — and therefore cannot obtain a connection without a workspace. Sending the parameter
yourself is still the honest thing to do, and the companions.build App definition does.
`/auth/mcp/get-session` and `/auth/oauth2/consent` are deliberately closed.

## Deployment configuration

There are no new secrets. There is one requirement: **`BETTER_AUTH_URL` must be the public origin
members browse to**, because Better Auth derives its issuer, its endpoint URLs and the
`authorization_servers` entry in the resource metadata from it. `apps/web/next.config.ts` already
rewrites `/auth/*`, `/v1/*`, `/mcp` and the root `.well-known` documents to the API, so one origin
serves everything.

```dotenv
# The origin members browse to, and the origin every OAuth and MCP URL is published under.
BETTER_AUTH_URL=https://skillpack.app
COMPANION_WEB_URL=https://skillpack.app
```

`COMPANION_WEB_URL` is where Skillpack sends the browser for sign-in (`/mcp/login`) and consent
(`/mcp/consent`).

## Connecting

1. In companions.build, open **Connections** and connect **Skillpack**. companions.build discovers
   the metadata and registers itself as a new public OAuth client.
2. Skillpack asks the member to sign in if they are not already.
3. The consent screen shows the requesting app and a **workspace picker**. The member chooses one
   organization and allows or denies.
4. Allowing records the client-to-workspace mapping and returns the authorization code;
   companions.build exchanges it and stores the grant. Denying records nothing at all.

One connection is one workspace. To connect a second workspace, connect the app again and choose
that workspace — the second connection registers its own client and stays isolated from the first.

## Revoking

`GET /v1/mcp/connections` lists the caller's connections with their workspace, client name and the
time their last token was issued. `DELETE /v1/mcp/connections/:clientId` revokes one: the OAuth
client is deleted and its tokens, consent record and workspace mapping cascade away with it. A
connection also stops working the moment the member loses their membership of the consented
workspace — the resolver re-proves it on every request.

## Acceptance checks

1. `curl ${PUBLIC_URL}/auth/.well-known/oauth-protected-resource` returns `resource` exactly equal to
   `${PUBLIC_URL}/mcp` and `authorization_servers` containing `${PUBLIC_URL}`.
2. `curl ${PUBLIC_URL}/mcp` without a bearer token returns 401 with a `WWW-Authenticate: Bearer
   resource_metadata="…"` header. `GET`/`DELETE` on `/mcp` answer 405: the server is stateless.
3. An authorize request that omits `prompt` still lands on `/mcp/consent`, and
   `POST ${PUBLIC_URL}/auth/oauth2/consent` and `GET ${PUBLIC_URL}/auth/mcp/get-session` both 404.
4. Connect from companions.build, confirm the consent screen names the redirect target and the
   requested scopes and lists your workspaces, allow, and check that the account reports healthy.
5. Enable the App on a test Companion and confirm `plugin_tools` lists the Skillpack tools.
6. Publish a throwaway skill with `skill_publish`, then `skill_archive` it, and confirm both audit
   rows appear in the workspace.
7. Connect a second workspace and confirm `skills_list` on each connection returns only its own
   workspace's skills.
