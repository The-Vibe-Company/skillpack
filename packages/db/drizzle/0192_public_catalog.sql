-- Public catalog discovery is a separate, explicit consent bit from the stable share link.
-- Existing public releases stay unlisted until an org Owner/Admin or personal creator opts them in;
-- there is no backfill.
ALTER TABLE "skills" ADD COLUMN "listed_publicly" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "listed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "public_package_files" jsonb;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_public_listing_complete_check" CHECK (
  (
    "listed_publicly" = false AND "listed_at" IS NULL
  ) OR (
    "listed_publicly" = true
    AND "listed_at" IS NOT NULL
    AND "public_version_id" IS NOT NULL
    AND "public_package_checksum" IS NOT NULL
    AND "public_package_size_bytes" IS NOT NULL
    AND "public_released_at" IS NOT NULL
    AND "public_package_files" IS NOT NULL
  )
);--> statement-breakpoint
CREATE INDEX "skills_public_catalog_idx"
  ON "skills" ("listed_publicly", "archived_at", "slug");--> statement-breakpoint

-- Keep only the public presentation allowlist from the immutable pinned version. The source
-- frontmatter is historical text, so malformed JSON is ignored rather than making an otherwise
-- valid catalog row fail closed at query time. The file list is read from the immutable release
-- snapshot on skills.public_package_files; frontmatter never supplies package metadata.
CREATE FUNCTION public.skillpack_public_catalog_manifest(p_frontmatter text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  raw jsonb;
BEGIN
  BEGIN
    raw := p_frontmatter::jsonb;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('name', NULL, 'description', NULL);
  END;

  IF jsonb_typeof(raw) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('name', NULL, 'description', NULL);
  END IF;

  RETURN jsonb_build_object(
    'name', CASE WHEN jsonb_typeof(raw -> 'name') = 'string' THEN raw ->> 'name' ELSE NULL END,
    'description', CASE WHEN jsonb_typeof(raw -> 'description') = 'string' THEN raw ->> 'description' ELSE NULL END
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.skillpack_public_catalog_manifest(text) FROM PUBLIC;--> statement-breakpoint

-- Anonymous catalog reads happen before a tenant context exists. Only this narrow projection is
-- executable by the API role; no table or sequence privileges are granted to process roles.
CREATE FUNCTION public.skillpack_list_public_catalog(
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
    skill."public_released_at",
    skill."public_package_checksum",
    skill."public_package_size_bytes",
    version."body",
    skill."public_package_files"
  FROM public."skills" AS skill
  JOIN public."organizations" AS organization
    ON organization."id" = skill."org_id"
  JOIN public."skill_versions" AS version
    ON version."org_id" = skill."org_id"
   AND version."skill_id" = skill."id"
   AND version."id" = skill."public_version_id"
  CROSS JOIN LATERAL public.skillpack_public_catalog_manifest(version."frontmatter") AS manifest("value")
  WHERE skill."listed_publicly" = true
    AND skill."archived_at" IS NULL
    AND skill."public_version_id" IS NOT NULL
    AND skill."public_package_checksum" IS NOT NULL
    AND skill."public_package_size_bytes" IS NOT NULL
    AND skill."public_released_at" IS NOT NULL
    AND skill."public_package_files" IS NOT NULL
    AND manifest."value" ->> 'name' IS NOT NULL
    AND manifest."value" ->> 'description' IS NOT NULL
    AND (
      p_label IS NULL
      OR (
        skill."scope" = 'org'
        AND EXISTS (
          SELECT 1
          FROM public."skill_labels" AS label
          WHERE label."org_id" = skill."org_id"
            AND label."skill_id" = skill."id"
            AND label."path" = p_label
        )
      )
    )
  ORDER BY organization."slug" ASC, skill."slug" ASC
  LIMIT p_limit OFFSET p_offset;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.skillpack_list_public_catalog(integer, integer, text) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.skillpack_get_public_catalog_skill(
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
    skill."public_released_at",
    skill."public_package_checksum",
    skill."public_package_size_bytes",
    version."body",
    skill."public_package_files"
  FROM public."organizations" AS organization
  JOIN public."skills" AS skill
    ON skill."org_id" = organization."id"
  JOIN public."skill_versions" AS version
    ON version."org_id" = skill."org_id"
   AND version."skill_id" = skill."id"
   AND version."id" = skill."public_version_id"
  CROSS JOIN LATERAL public.skillpack_public_catalog_manifest(version."frontmatter") AS manifest("value")
  WHERE organization."slug" = p_org_slug
    AND skill."slug" = p_skill_slug
    AND skill."listed_publicly" = true
    AND skill."archived_at" IS NULL
    AND skill."public_version_id" IS NOT NULL
    AND skill."public_package_checksum" IS NOT NULL
    AND skill."public_package_size_bytes" IS NOT NULL
    AND skill."public_released_at" IS NOT NULL
    AND skill."public_package_files" IS NOT NULL
    AND manifest."value" ->> 'name' IS NOT NULL
    AND manifest."value" ->> 'description' IS NOT NULL
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.skillpack_get_public_catalog_skill(text, text) FROM PUBLIC;
