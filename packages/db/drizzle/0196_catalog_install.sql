-- Reuse the catalog validation/visibility projection for package delivery. The org ID is internal
-- storage context only; no share token or mutable public-release pointer crosses this boundary.
CREATE FUNCTION public.skillpack_get_public_catalog_package(p_org_slug text, p_skill_slug text)
RETURNS TABLE (org_id uuid, skill_slug text, version text, checksum text, size_bytes integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT organization.id, catalog.skill_slug, catalog.version, catalog.checksum, catalog.size_bytes
  FROM public.skillpack_get_public_catalog_skill(p_org_slug, p_skill_slug) AS catalog
  JOIN public.organizations AS organization ON organization.slug = catalog.org_slug
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.skillpack_get_public_catalog_package(text, text) FROM PUBLIC;
