-- Better Auth 1.7 MCP cutover. Deploy migration and API together with old API instances stopped.
-- Preserve registered client IDs, approved consents, exact-workspace mappings, and the original
-- access/refresh expiry. Legacy plaintext credentials become SHA-256 base64url digests; pending
-- 1.6 authorization codes expire naturally and must restart authorization on the new server.
-- 1.6 stored browser sessions only in PostgreSQL secondary storage by default. The 1.7
-- provider requires durable session rows for authorization-code exchange. Copy only matching,
-- live session payloads, preserving their IDs, tokens and original expiry; ignore other cache keys.
WITH cache AS (
  SELECT "key", CASE WHEN pg_input_is_valid("value", 'jsonb') THEN "value"::jsonb END AS payload
  FROM "agent_auth_ephemeral"
  WHERE "expires_at" IS NULL OR "expires_at" > now()
), cached_sessions AS (
  SELECT "key", payload->'session' AS s FROM cache
  WHERE jsonb_typeof(payload->'session') = 'object'
), live_sessions AS (
  SELECT "key", s,
    CASE WHEN pg_input_is_valid(s->>'expiresAt', 'timestamp with time zone')
      THEN (s->>'expiresAt')::timestamp with time zone END AS expiry
  FROM cached_sessions
)
INSERT INTO "session" ("id", "user_id", "token", "expires_at", "ip_address", "user_agent", "created_at", "updated_at")
SELECT s->>'id', s->>'userId', s->>'token', expiry, s->>'ipAddress', s->>'userAgent',
  CASE WHEN pg_input_is_valid(s->>'createdAt', 'timestamp with time zone')
    THEN (s->>'createdAt')::timestamp with time zone ELSE now() END,
  CASE WHEN pg_input_is_valid(s->>'updatedAt', 'timestamp with time zone')
    THEN (s->>'updatedAt')::timestamp with time zone ELSE now() END
FROM live_sessions
WHERE "key" = s->>'token' AND NULLIF(s->>'id', '') IS NOT NULL AND expiry > now()
  AND EXISTS (SELECT 1 FROM "user" u WHERE u."id" = s->>'userId')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

ALTER TABLE "oauth_application" RENAME COLUMN "redirect_urls" TO "redirect_uris";
ALTER TABLE "oauth_application" ALTER COLUMN "redirect_uris" TYPE text[] USING string_to_array("redirect_uris", ',');
ALTER TABLE "oauth_application" ALTER COLUMN "metadata" TYPE jsonb USING "metadata"::jsonb;
ALTER TABLE "oauth_application" ALTER COLUMN "name" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "client_discovery_id" text;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "skip_consent" boolean;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "enable_end_session" boolean;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "subject_type" text;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "scopes" text[];
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "client_credentials_scopes" text[] DEFAULT '{}'::text[];
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "uri" text;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "contacts" text[];
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "tos" text;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "policy" text;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "software_id" text;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "software_version" text;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "software_statement" text;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "post_logout_redirect_uris" text[];
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "backchannel_logout_uri" text;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "backchannel_logout_session_required" boolean;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "token_endpoint_auth_method" text;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "application_type" text;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "jwks" text;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "jwks_uri" text;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "grant_types" text[];
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "response_types" text[];
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "require_pkce" boolean;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "dpop_bound_access_tokens" boolean DEFAULT false;
--> statement-breakpoint

ALTER TABLE "oauth_application" ADD COLUMN "reference_id" text;
--> statement-breakpoint

UPDATE "oauth_application" SET
  "token_endpoint_auth_method" = CASE WHEN "type" = 'public' THEN 'none' ELSE 'client_secret_basic' END,
  "reference_id" = CASE WHEN "type" <> 'public' THEN 'skillpack:mcp-1.6-confidential' END,
  "application_type" = CASE WHEN "type" = 'native' THEN 'native' ELSE 'web' END,
  "grant_types" = ARRAY['authorization_code', 'refresh_token'],
  "response_types" = ARRAY['code'], "require_pkce" = true, "skip_consent" = false,
  "client_credentials_scopes" = ARRAY[]::text[],
  "scopes" = ARRAY['openid', 'profile', 'email', 'offline_access'],
  "client_secret" = CASE WHEN "type" = 'public' THEN NULL ELSE
    translate(rtrim(encode(sha256(convert_to("client_secret", 'UTF8')), 'base64'), '='), '+/', '-_') END;
ALTER TABLE "oauth_application" DROP COLUMN "type";
--> statement-breakpoint

CREATE TABLE "oauth_resource" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "access_token_ttl" integer,
  "refresh_token_ttl" integer,
  "signing_algorithm" text,
  "signing_key_id" text,
  "allowed_scopes" text[],
  "custom_claims" jsonb,
  "dpop_bound_access_tokens_required" boolean DEFAULT false,
  "disabled" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "policy_version" integer DEFAULT 1,
  "metadata" jsonb
);
--> statement-breakpoint

CREATE TABLE "oauth_client_resource" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "oauth_application"("client_id") ON DELETE cascade,
  "resource_id" text NOT NULL REFERENCES "oauth_resource"("identifier") ON DELETE cascade,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "oauth_client_resource_client_id_idx" ON "oauth_client_resource" ("client_id");
--> statement-breakpoint
CREATE INDEX "oauth_client_resource_resource_id_idx" ON "oauth_client_resource" ("resource_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_client_resource_client_resource_idx" ON "oauth_client_resource" ("client_id", "resource_id");
--> statement-breakpoint

CREATE TABLE "oauth_refresh_token" (
  "id" text PRIMARY KEY NOT NULL,
  "token" text NOT NULL UNIQUE,
  "client_id" text NOT NULL REFERENCES "oauth_application"("client_id") ON DELETE cascade,
  "session_id" text REFERENCES "session"("id") ON DELETE set null,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "reference_id" text,
  "authorization_code_id" text,
  "resources" text[],
  "requested_user_info_claims" text[],
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "revoked" timestamp with time zone,
  "rotated_at" timestamp with time zone,
  "rotation_replay_response" text,
  "rotation_replay_expires_at" timestamp with time zone,
  "auth_time" timestamp with time zone,
  "confirmation" jsonb,
  "scopes" text[] NOT NULL
);
--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_client_id_idx" ON "oauth_refresh_token" ("client_id");
--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_session_id_idx" ON "oauth_refresh_token" ("session_id");
--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_user_id_idx" ON "oauth_refresh_token" ("user_id");
--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_authorization_code_id_idx" ON "oauth_refresh_token" ("authorization_code_id");
--> statement-breakpoint

CREATE TABLE "oauth_client_assertion" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint

CREATE TABLE "jwks" (
  "id" text PRIMARY KEY NOT NULL,
  "public_key" text NOT NULL,
  "private_key" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone,
  "alg" text,
  "crv" text
);
--> statement-breakpoint

INSERT INTO "oauth_refresh_token" ("id", "token", "client_id", "user_id", "scopes", "expires_at", "created_at")
SELECT "id", translate(rtrim(encode(sha256(convert_to("refresh_token", 'UTF8')), 'base64'), '='), '+/', '-_'),
       "client_id", "user_id", array_remove(regexp_split_to_array(trim("scopes"), '\s+'), ''), "refresh_token_expires_at", "created_at"
FROM "oauth_access_token" WHERE "user_id" IS NOT NULL;
ALTER TABLE "oauth_access_token" RENAME COLUMN "access_token" TO "token";
ALTER TABLE "oauth_access_token" RENAME COLUMN "access_token_expires_at" TO "expires_at";
UPDATE "oauth_access_token" SET "token" = translate(rtrim(encode(sha256(convert_to("token", 'UTF8')), 'base64'), '='), '+/', '-_');
ALTER TABLE "oauth_access_token" ALTER COLUMN "scopes" TYPE text[] USING array_remove(regexp_split_to_array(trim("scopes"), '\s+'), '');
ALTER TABLE "oauth_access_token" ADD COLUMN "refresh_id" text REFERENCES "oauth_refresh_token"("id") ON DELETE cascade;
UPDATE "oauth_access_token" a SET "refresh_id" = a."id" WHERE EXISTS (SELECT 1 FROM "oauth_refresh_token" r WHERE r."id" = a."id");
ALTER TABLE "oauth_access_token" DROP COLUMN "refresh_token", DROP COLUMN "refresh_token_expires_at", DROP COLUMN "updated_at";
--> statement-breakpoint

ALTER TABLE "oauth_access_token" ADD COLUMN "session_id" text REFERENCES "session"("id") ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE "oauth_access_token" ADD COLUMN "reference_id" text;
--> statement-breakpoint

ALTER TABLE "oauth_access_token" ADD COLUMN "authorization_code_id" text;
--> statement-breakpoint

ALTER TABLE "oauth_access_token" ADD COLUMN "resources" text[];
--> statement-breakpoint

ALTER TABLE "oauth_access_token" ADD COLUMN "requested_user_info_claims" text[];
--> statement-breakpoint

ALTER TABLE "oauth_access_token" ADD COLUMN "revoked" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "oauth_access_token" ADD COLUMN "confirmation" jsonb;
--> statement-breakpoint

-- Presence of a consent now denotes approval; denied historical decisions must not authorize.
DELETE FROM "oauth_consent" WHERE NOT "consent_given";
ALTER TABLE "oauth_consent" DROP COLUMN "consent_given";
ALTER TABLE "oauth_consent" ALTER COLUMN "scopes" TYPE text[] USING array_remove(regexp_split_to_array(trim("scopes"), '\s+'), '');
ALTER TABLE "oauth_consent" ADD COLUMN "reference_id" text, ADD COLUMN "resources" text[], ADD COLUMN "requested_user_info_claims" text[];
--> statement-breakpoint

CREATE OR REPLACE FUNCTION companion_resolve_mcp_connection(p_client_id text, p_user_id text)
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
    )
  LIMIT 1
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION companion_list_mcp_connections(p_user_id text)
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
           FROM public."oauth_refresh_token" t
           WHERE t."client_id" = w."client_id"
         )
  FROM public."mcp_client_workspaces" w
  JOIN public."oauth_application" a ON a."client_id" = w."client_id"
  JOIN public."organizations" o ON o."id" = w."org_id"
  WHERE w."user_id" = p_user_id
  ORDER BY w."created_at" DESC
$$;

--> statement-breakpoint
CREATE INDEX "oauth_access_token_session_id_idx" ON "oauth_access_token" ("session_id");
CREATE INDEX "oauth_access_token_authorization_code_id_idx" ON "oauth_access_token" ("authorization_code_id");
CREATE INDEX "oauth_access_token_refresh_id_idx" ON "oauth_access_token" ("refresh_id");
