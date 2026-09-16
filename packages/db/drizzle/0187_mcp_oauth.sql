-- Better Auth `mcp` plugin storage. These three tables are global identity data (like user/session/
-- account/verification): an OAuth client belongs to a Better Auth user, not to an organization.
CREATE TABLE "oauth_application" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "icon" text,
  "metadata" text,
  "client_id" text NOT NULL UNIQUE,
  "client_secret" text,
  "redirect_urls" text NOT NULL,
  "type" text NOT NULL,
  "disabled" boolean DEFAULT false NOT NULL,
  "user_id" text REFERENCES "user"("id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "oauth_application_user_id_idx" ON "oauth_application" ("user_id");--> statement-breakpoint

CREATE TABLE "oauth_access_token" (
  "id" text PRIMARY KEY NOT NULL,
  "access_token" text NOT NULL UNIQUE,
  "refresh_token" text NOT NULL UNIQUE,
  "access_token_expires_at" timestamp with time zone NOT NULL,
  "refresh_token_expires_at" timestamp with time zone NOT NULL,
  "client_id" text NOT NULL REFERENCES "oauth_application"("client_id") ON DELETE cascade,
  "user_id" text REFERENCES "user"("id") ON DELETE cascade,
  "scopes" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "oauth_access_token_client_id_idx" ON "oauth_access_token" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_user_id_idx" ON "oauth_access_token" ("user_id");--> statement-breakpoint

CREATE TABLE "oauth_consent" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "oauth_application"("client_id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "scopes" text NOT NULL,
  "consent_given" boolean NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "oauth_consent_client_id_idx" ON "oauth_consent" ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_consent_user_id_idx" ON "oauth_consent" ("user_id");--> statement-breakpoint

-- The consented workspace for one MCP client. Tenant-owned, so it carries org_id and RLS: a
-- connection may only ever act inside the organization the member chose on the consent screen.
CREATE TABLE "mcp_client_workspaces" (
  "client_id" text PRIMARY KEY NOT NULL REFERENCES "oauth_application"("client_id") ON DELETE cascade,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "mcp_client_workspaces_member_idx" ON "mcp_client_workspaces" ("org_id", "user_id");--> statement-breakpoint
ALTER TABLE "mcp_client_workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "mcp_client_workspaces_tenant_rls" ON "mcp_client_workspaces"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

-- An MCP request arrives with a bearer token and no workspace selection, so the mapping must be
-- read before `app.org_id` can exist. Like companion_resolve_api_token, the lookup is delegated to a
-- narrow SECURITY DEFINER function that also proves current membership: a removed member resolves
-- to no row and every tool call fails closed.
--
-- The recorded consent is required as well as the mapping. The mapping is written by the consent
-- screen just before the grant is approved, so if that approval never lands the row would otherwise
-- be a standing workspace binding for a client the member never finished approving.
CREATE FUNCTION companion_resolve_mcp_connection(p_client_id text, p_user_id text)
RETURNS TABLE (
  "org_id" uuid,
  "user_id" text,
  "email" text,
  "name" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT w."org_id", w."user_id",
         COALESCE(p."email", u."email") AS "email",
         COALESCE(NULLIF(p."name", ''), NULLIF(u."name", ''), p."email", u."email", w."user_id") AS "name"
  FROM public."mcp_client_workspaces" w
  JOIN public."oauth_application" a ON a."client_id" = w."client_id" AND a."disabled" = false
  JOIN public."memberships" m ON m."org_id" = w."org_id" AND m."user_id" = w."user_id"
  JOIN public."user" u ON u."id" = w."user_id"
  LEFT JOIN public."profiles" p ON p."id" = w."user_id"
  WHERE w."client_id" = p_client_id
    AND w."user_id" = p_user_id
    AND EXISTS (
      SELECT 1 FROM public."oauth_consent" c
      WHERE c."client_id" = w."client_id"
        AND c."user_id" = w."user_id"
        AND c."consent_given"
    )
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION companion_resolve_mcp_connection(text, text) FROM PUBLIC;--> statement-breakpoint

-- Settings lists a member's own MCP connections across every workspace they consented into.
CREATE FUNCTION companion_list_mcp_connections(p_user_id text)
RETURNS TABLE (
  "client_id" text,
  "client_name" text,
  "org_id" uuid,
  "org_name" text,
  "created_at" timestamp with time zone,
  "last_token_issued_at" timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT w."client_id", a."name", w."org_id", o."name", w."created_at",
         (
           SELECT max(t."created_at")
           FROM public."oauth_access_token" t
           WHERE t."client_id" = w."client_id"
         )
  FROM public."mcp_client_workspaces" w
  JOIN public."oauth_application" a ON a."client_id" = w."client_id"
  JOIN public."organizations" o ON o."id" = w."org_id"
  WHERE w."user_id" = p_user_id
  ORDER BY w."created_at" DESC
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION companion_list_mcp_connections(text) FROM PUBLIC;--> statement-breakpoint

-- Revocation deletes the registered client, which cascades to its tokens, consent and mapping.
-- Ownership comes from the consented mapping: dynamically registered clients carry no user id.
CREATE FUNCTION companion_revoke_mcp_connection(p_client_id text, p_user_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public."oauth_application" a
  WHERE a."client_id" = p_client_id
    AND EXISTS (
      SELECT 1 FROM public."mcp_client_workspaces" w
      WHERE w."client_id" = p_client_id AND w."user_id" = p_user_id
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION companion_revoke_mcp_connection(text, text) FROM PUBLIC;
