CREATE TABLE skill_usage_events (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  version text NOT NULL CHECK (length(version) BETWEEN 1 AND 128),
  agent text CHECK (agent IN ('claude-code', 'codex', 'opencode', 'pi', 'other')),
  environment text CHECK (environment IN ('conductor', 'ci', 'sandbox', 'local', 'other')),
  declared_user_id text CHECK (length(declared_user_id) BETWEEN 1 AND 128),
  declared_email text CHECK (length(declared_email) BETWEEN 3 AND 254),
  identity_source text CHECK (identity_source IN ('configured', 'skillpack-local', 'git-local', 'git-global')),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, skill_id, event_id),
  CHECK ((identity_source IS NULL AND declared_user_id IS NULL AND declared_email IS NULL)
    OR (identity_source IS NOT NULL AND (declared_user_id IS NOT NULL OR declared_email IS NOT NULL)))
);
--> statement-breakpoint
CREATE INDEX skill_usage_events_skill_time_idx ON skill_usage_events(org_id, skill_id, received_at);
--> statement-breakpoint
CREATE INDEX skill_usage_events_retention_idx ON skill_usage_events(received_at);
--> statement-breakpoint
ALTER TABLE skill_usage_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE skill_usage_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- SELECT is the only tenant operation. Anonymous writes and worker expiry use narrow definers.
CREATE POLICY skill_usage_events_read ON skill_usage_events FOR SELECT USING (
  org_id = nullif(current_setting('app.org_id', true), '')::uuid
  AND received_at >= now() - interval '90 days'
  AND EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = skill_usage_events.org_id
    AND m.user_id = nullif(current_setting('app.user_id', true), ''))
  AND EXISTS (SELECT 1 FROM skills s WHERE s.id = skill_usage_events.skill_id
    AND s.org_id = skill_usage_events.org_id
    AND (s.scope = 'org' OR s.creator_id = nullif(current_setting('app.user_id', true), '')))
);
--> statement-breakpoint
-- Same owner-only escape hatch as the other pre-tenant definers. Runtime roles
-- are NOBYPASSRLS, do not own tables, and cannot assume the migration owner.
CREATE POLICY skill_usage_events_owner ON skill_usage_events FOR ALL
  USING (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.skill_usage_events'::regclass)))
  WITH CHECK (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.skill_usage_events'::regclass)));
--> statement-breakpoint
-- No identity lookup or tenant input: possession of an ID can only append an unverified report.
-- Return void for both known and unknown skills/versions and rate-limited reports.
CREATE FUNCTION skillpack_report_skill_usage(p_event jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_org uuid;
  v_skill uuid := (p_event->>'skill_id')::uuid;
BEGIN
  SELECT s.org_id INTO v_org FROM public.skills s
    JOIN public.skill_versions v ON v.skill_id = s.id AND v.org_id = s.org_id
    WHERE s.id = v_skill AND v.version = p_event->>'version' LIMIT 1;
  IF v_org IS NULL THEN RETURN; END IF;
  -- Serialize admission per skill across API replicas. At most 120 reports/minute/skill.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_skill::text, 188));
  IF (SELECT count(*) FROM public.skill_usage_events
    WHERE org_id = v_org AND skill_id = v_skill
      AND received_at >= date_trunc('minute', now())) >= 120 THEN RETURN; END IF;
  INSERT INTO public.skill_usage_events (
    org_id, skill_id, event_id, version, agent, environment,
    declared_user_id, declared_email, identity_source
  ) VALUES (
    v_org, v_skill, (p_event->>'event_id')::uuid, p_event->>'version',
    p_event->>'agent', p_event->>'environment',
    p_event->'identity'->>'user_id', p_event->'identity'->>'email', p_event->'identity'->>'source'
  ) ON CONFLICT DO NOTHING;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION skillpack_report_skill_usage(jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION skillpack_expire_skill_usage() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.skill_usage_events WHERE (org_id, skill_id, event_id) IN (
    SELECT org_id, skill_id, event_id FROM public.skill_usage_events
    WHERE received_at < now() - interval '90 days' ORDER BY received_at LIMIT 10000
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION skillpack_expire_skill_usage() FROM PUBLIC;
