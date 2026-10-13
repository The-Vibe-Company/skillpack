-- Catalog publication decisions retain an immutable package snapshot. A later public-release
-- promotion may move skills.public_version_id without changing the validated catalog entry.
CREATE TYPE "catalog_submission_status" AS ENUM ('proposed', 'validated', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "catalog_submission_kind" AS ENUM ('publish_request', 'submission');--> statement-breakpoint

CREATE TABLE "catalog_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "skill_id" uuid NOT NULL,
  "skill_version_id" uuid NOT NULL,
  "package_checksum" text NOT NULL,
  "package_size_bytes" integer NOT NULL,
  "package_files" jsonb NOT NULL,
  "status" "catalog_submission_status" DEFAULT 'proposed' NOT NULL,
  "kind" "catalog_submission_kind" NOT NULL,
  "requested_by" text REFERENCES "user"("id"),
  "submitted_by" text REFERENCES "user"("id"),
  "decided_by" text REFERENCES "user"("id"),
  "decided_at" timestamp with time zone,
  "rejection_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catalog_submissions_skill_org_fk"
    FOREIGN KEY ("org_id", "skill_id")
    REFERENCES "skills"("org_id", "id") ON DELETE cascade,
  CONSTRAINT "catalog_submissions_version_org_skill_fk"
    FOREIGN KEY ("org_id", "skill_id", "skill_version_id")
    REFERENCES "skill_versions"("org_id", "skill_id", "id") ON DELETE cascade,
  CONSTRAINT "catalog_submissions_package_checksum_check"
    CHECK ("package_checksum" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "catalog_submissions_package_size_check"
    CHECK ("package_size_bytes" >= 0),
  CONSTRAINT "catalog_submissions_package_files_check"
    CHECK (jsonb_typeof("package_files") = 'array'),
  CONSTRAINT "catalog_submissions_request_actor_check"
    CHECK (
      ("kind" = 'publish_request'
        AND "requested_by" IS NOT NULL AND "submitted_by" IS NULL)
      OR ("kind" = 'submission' AND "submitted_by" IS NOT NULL)
    ),
  CONSTRAINT "catalog_submissions_decision_check"
    CHECK (
      ("status" = 'proposed' AND "decided_by" IS NULL AND "decided_at" IS NULL)
      OR ("status" IN ('validated', 'rejected')
        AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL)
      OR "status" = 'withdrawn'
    )
);--> statement-breakpoint

CREATE UNIQUE INDEX "catalog_submissions_one_proposed_per_skill_idx"
  ON "catalog_submissions" ("org_id", "skill_id")
  WHERE "status" = 'proposed';--> statement-breakpoint
CREATE INDEX "catalog_submissions_org_status_idx"
  ON "catalog_submissions" ("org_id", "status", "created_at");--> statement-breakpoint
CREATE INDEX "catalog_submissions_skill_status_idx"
  ON "catalog_submissions" ("org_id", "skill_id", "status", "decided_at", "created_at", "id");--> statement-breakpoint
CREATE INDEX "catalog_submissions_requested_by_idx"
  ON "catalog_submissions" ("org_id", "requested_by", "created_at");--> statement-breakpoint

ALTER TABLE "catalog_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "catalog_submissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "catalog_submissions_tenant_rls" ON "catalog_submissions"
  USING (
    "org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM "memberships" AS membership
      WHERE membership."org_id" = "catalog_submissions"."org_id"
        AND membership."user_id" = NULLIF(current_setting('app.user_id', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM "skills" AS skill
      WHERE skill."org_id" = "catalog_submissions"."org_id"
        AND skill."id" = "catalog_submissions"."skill_id"
        AND skill."scope" = 'org'
    )
  )
  WITH CHECK (
    "org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM "memberships" AS membership
      WHERE membership."org_id" = "catalog_submissions"."org_id"
        AND membership."user_id" = NULLIF(current_setting('app.user_id', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM "skills" AS skill
      WHERE skill."org_id" = "catalog_submissions"."org_id"
        AND skill."id" = "catalog_submissions"."skill_id"
        AND skill."scope" = 'org'
    )
  );--> statement-breakpoint
-- SECURITY DEFINER catalog readers run as the migration owner. FORCE RLS therefore needs an
-- explicit owner policy in addition to the process-role tenant policy above.
CREATE POLICY "catalog_submissions_owner_rls" ON "catalog_submissions" FOR ALL
  USING (
    current_user = pg_catalog.pg_get_userbyid((
      SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.catalog_submissions'::regclass
    ))
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((
      SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.catalog_submissions'::regclass
    ))
  );--> statement-breakpoint

-- Listing consent no longer depends on the mutable public-release pointer. Core explicitly clears
-- consent when a release is cleared or a skill is archived; validated snapshots remain independent.
ALTER TABLE "skills" DROP CONSTRAINT "skills_public_listing_complete_check";--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_public_listing_complete_check" CHECK (
  (
    "listed_publicly" = false AND "listed_at" IS NULL
  ) OR (
    "listed_publicly" = true
    AND "scope" = 'org'
    AND "listed_at" IS NOT NULL
  )
);--> statement-breakpoint

-- Anonymous catalog readers use the newest validated snapshot, never skills.public_version_id or
-- the mutable public package columns. The presentation allowlist remains the same as 0192.
CREATE OR REPLACE FUNCTION public.skillpack_list_public_catalog(
  p_limit integer,
  p_offset integer,
  p_label text DEFAULT NULL
)
RETURNS TABLE (
  "org_name" text,
  "org_slug" text,
  "skill_slug" text,
  "name" text,
  "description" text,
  "version" text,
  "released_at" timestamp with time zone,
  "checksum" text,
  "size_bytes" integer,
  "body" text,
  "files" jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50
     OR p_offset IS NULL OR p_offset < 0 OR p_offset > 10000 THEN
    RAISE EXCEPTION 'public catalog pagination is out of bounds'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    organization."name",
    organization."slug",
    skill."slug",
    manifest."value" ->> 'name',
    manifest."value" ->> 'description',
    version."version",
    catalog_submission."decided_at",
    catalog_submission."package_checksum",
    catalog_submission."package_size_bytes",
    version."body",
    catalog_submission."package_files"
  FROM public."skills" AS skill
  JOIN public."organizations" AS organization
    ON organization."id" = skill."org_id"
  JOIN LATERAL (
    SELECT submission."id", submission."skill_version_id", submission."decided_at",
           submission."package_checksum", submission."package_size_bytes", submission."package_files"
    FROM public."catalog_submissions" AS submission
    WHERE submission."org_id" = skill."org_id"
      AND submission."skill_id" = skill."id"
      AND submission."status" = 'validated'
    ORDER BY submission."decided_at" DESC, submission."created_at" DESC, submission."id" DESC
    LIMIT 1
  ) AS catalog_submission ON true
  JOIN public."skill_versions" AS version
    ON version."org_id" = skill."org_id"
   AND version."skill_id" = skill."id"
   AND version."id" = catalog_submission."skill_version_id"
  CROSS JOIN LATERAL public.skillpack_public_catalog_manifest(version."frontmatter") AS manifest("value")
  WHERE skill."scope" = 'org'
    AND skill."listed_publicly" = true
    AND skill."archived_at" IS NULL
    AND manifest."value" ->> 'name' IS NOT NULL
    AND manifest."value" ->> 'description' IS NOT NULL
    AND (
      p_label IS NULL
      OR EXISTS (
        SELECT 1
        FROM public."skill_labels" AS label
        WHERE label."org_id" = skill."org_id"
          AND label."skill_id" = skill."id"
          AND label."path" = p_label
      )
    )
  ORDER BY organization."slug" ASC, skill."slug" ASC
  LIMIT p_limit OFFSET p_offset;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.skillpack_list_public_catalog(integer, integer, text) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.skillpack_get_public_catalog_skill(
  p_org_slug text,
  p_skill_slug text
)
RETURNS TABLE (
  "org_name" text,
  "org_slug" text,
  "skill_slug" text,
  "name" text,
  "description" text,
  "version" text,
  "released_at" timestamp with time zone,
  "checksum" text,
  "size_bytes" integer,
  "body" text,
  "files" jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    organization."name",
    organization."slug",
    skill."slug",
    manifest."value" ->> 'name',
    manifest."value" ->> 'description',
    version."version",
    catalog_submission."decided_at",
    catalog_submission."package_checksum",
    catalog_submission."package_size_bytes",
    version."body",
    catalog_submission."package_files"
  FROM public."organizations" AS organization
  JOIN public."skills" AS skill
    ON skill."org_id" = organization."id"
  JOIN LATERAL (
    SELECT submission."id", submission."skill_version_id", submission."decided_at",
           submission."package_checksum", submission."package_size_bytes", submission."package_files"
    FROM public."catalog_submissions" AS submission
    WHERE submission."org_id" = skill."org_id"
      AND submission."skill_id" = skill."id"
      AND submission."status" = 'validated'
    ORDER BY submission."decided_at" DESC, submission."created_at" DESC, submission."id" DESC
    LIMIT 1
  ) AS catalog_submission ON true
  JOIN public."skill_versions" AS version
    ON version."org_id" = skill."org_id"
   AND version."skill_id" = skill."id"
   AND version."id" = catalog_submission."skill_version_id"
  CROSS JOIN LATERAL public.skillpack_public_catalog_manifest(version."frontmatter") AS manifest("value")
  WHERE organization."slug" = p_org_slug
    AND skill."slug" = p_skill_slug
    AND skill."scope" = 'org'
    AND skill."listed_publicly" = true
    AND skill."archived_at" IS NULL
    AND manifest."value" ->> 'name' IS NOT NULL
    AND manifest."value" ->> 'description' IS NOT NULL
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.skillpack_get_public_catalog_skill(text, text) FROM PUBLIC;
