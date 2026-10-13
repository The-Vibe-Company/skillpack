-- Anonymous writes and platform-only reads use narrow API security definers. No tenant policy.
CREATE TABLE public.catalog_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL,
  submission_id uuid NOT NULL REFERENCES public.catalog_submissions(id) ON DELETE CASCADE,
  org_slug text NOT NULL,
  skill_slug text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('secret_exposure', 'malicious', 'license', 'spam')),
  details text CHECK (char_length(details) <= 2000),
  reporter_hash text NOT NULL CHECK (reporter_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_reports_skill_org_fk FOREIGN KEY (org_id, skill_id)
    REFERENCES public.skills(org_id, id) ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX catalog_reports_source_time_idx ON public.catalog_reports(reporter_hash, created_at);--> statement-breakpoint
CREATE INDEX catalog_reports_queue_idx ON public.catalog_reports(created_at, id);--> statement-breakpoint
ALTER TABLE public.catalog_reports ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.catalog_reports FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalog_reports_owner_rls ON public.catalog_reports FOR ALL
  USING (current_user = pg_catalog.pg_get_userbyid((
    SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.catalog_reports'::regclass
  )))
  WITH CHECK (current_user = pg_catalog.pg_get_userbyid((
    SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.catalog_reports'::regclass
  )));--> statement-breakpoint

CREATE FUNCTION public.skillpack_report_catalog_skill(
  p_org_slug text, p_skill_slug text, p_reason text, p_details text, p_hash text
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = on
AS $$
DECLARE
  v_org uuid;
  v_skill uuid;
  v_submission uuid;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('secret_exposure', 'malicious', 'license', 'spam')
     OR char_length(p_details) > 2000 OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid catalog report' USING ERRCODE = '22023';
  END IF;
  -- Serialize admission across API processes, skills and organizations for this anonymous source.
  PERFORM pg_advisory_xact_lock(hashtextextended('catalog-report:' || p_hash, 0));
  IF (SELECT count(*) FROM public.catalog_reports
      WHERE reporter_hash = p_hash AND created_at > clock_timestamp() - interval '1 hour') >= 5 THEN
    RETURN 'rate_limited';
  END IF;

  SELECT skill.org_id, skill.id INTO v_org, v_skill
  FROM public.skills AS skill
  JOIN public.organizations AS organization ON organization.id = skill.org_id
  WHERE organization.slug = p_org_slug AND skill.slug = p_skill_slug
  FOR SHARE OF skill;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  -- Reuse the public projection's complete consent/privacy predicate under the skill lock.
  IF NOT EXISTS (SELECT 1 FROM public.skillpack_get_public_catalog_skill(p_org_slug, p_skill_slug)) THEN
    RETURN 'not_found';
  END IF;
  SELECT submission.id INTO v_submission FROM public.catalog_submissions AS submission
  WHERE submission.org_id = v_org AND submission.skill_id = v_skill
    AND submission.status::text = 'validated' AND submission.kind::text = 'submission'
  ORDER BY submission.decided_at DESC, submission.created_at DESC, submission.id DESC LIMIT 1;
  IF v_submission IS NULL THEN RETURN 'not_found'; END IF;

  INSERT INTO public.catalog_reports(org_id, skill_id, submission_id, org_slug, skill_slug, reason, details, reporter_hash)
  VALUES (v_org, v_skill, v_submission, p_org_slug, p_skill_slug, p_reason, NULLIF(btrim(p_details), ''), p_hash);
  RETURN 'accepted';
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.skillpack_report_catalog_skill(text,text,text,text,text) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.skillpack_catalog_report_queue(p_actor text, p_configured boolean, p_limit integer, p_offset integer)
RETURNS TABLE(id uuid, org_id uuid, skill_id uuid, submission_id uuid, org_slug text, skill_slug text,
  reason text, details text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = on
AS $$
BEGIN
  IF NOT public.skillpack_is_catalog_moderator(p_actor, p_configured) THEN
    RAISE EXCEPTION 'catalog moderator authorization required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 OR p_offset IS NULL OR p_offset < 0 OR p_offset > 10000 THEN
    RAISE EXCEPTION 'invalid report pagination' USING ERRCODE = '22023';
  END IF;
  -- Reports stay reviewable after removal. Abuse hashes are never part of the HTTP projection.
  RETURN QUERY SELECT report.id, report.org_id, report.skill_id, report.submission_id,
    report.org_slug, report.skill_slug, report.reason, report.details, report.created_at
  FROM public.catalog_reports AS report ORDER BY report.created_at ASC, report.id ASC
  LIMIT p_limit OFFSET p_offset;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.skillpack_catalog_report_queue(text,boolean,integer,integer) FROM PUBLIC;
