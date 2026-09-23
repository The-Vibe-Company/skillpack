-- Keep existing observations as a separate historical category. No old emitter remains active.
ALTER TABLE skill_usage_events ADD COLUMN kind text NOT NULL DEFAULT 'legacy'
  CHECK (kind IN ('legacy', 'invocation', 'request', 'read'));
--> statement-breakpoint
ALTER TABLE skill_usage_events ADD COLUMN adapter text
  CHECK (adapter IN ('claude-hook', 'claude-transcript', 'codex-hook', 'codex-transcript', 'opencode-plugin'));
--> statement-breakpoint
ALTER TABLE skill_usage_events ADD COLUMN observed_at timestamptz;
--> statement-breakpoint
DROP FUNCTION IF EXISTS skillpack_report_skill_usage(jsonb);
--> statement-breakpoint
-- This pre-tenant inbox cannot resolve a skill's existence or return its tenant. Completed
-- receipts retain only opaque IDs for eight days, longer than the client retry lifetime.
CREATE TABLE skill_usage_inbox (
  event_id uuid PRIMARY KEY,
  declared_skill_id uuid NOT NULL,
  payload jsonb CHECK (octet_length(payload::text) <= 4096),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
--> statement-breakpoint
CREATE INDEX skill_usage_inbox_pending_idx ON skill_usage_inbox(received_at) WHERE processed_at IS NULL;
--> statement-breakpoint
CREATE INDEX skill_usage_inbox_admission_idx ON skill_usage_inbox(declared_skill_id, received_at);
--> statement-breakpoint
CREATE INDEX skill_usage_inbox_expiry_idx ON skill_usage_inbox(processed_at) WHERE processed_at IS NOT NULL;
--> statement-breakpoint
ALTER TABLE skill_usage_inbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE skill_usage_inbox FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY skill_usage_inbox_owner ON skill_usage_inbox FOR ALL
  USING (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.skill_usage_inbox'::regclass)))
  WITH CHECK (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.skill_usage_inbox'::regclass)));
--> statement-breakpoint
CREATE FUNCTION skillpack_receive_skill_usage(p_event jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id uuid := (p_event->>'event_id')::uuid;
  v_skill uuid := (p_event->>'skill_id')::uuid;
BEGIN
  -- Only the API may invoke this function; API validation enforces the wire schema.
  IF octet_length(p_event::text) > 4096 OR p_event->>'schema_version' IS DISTINCT FROM '1'
    OR p_event->>'kind' NOT IN ('invocation', 'request', 'read') THEN
    RAISE EXCEPTION 'invalid usage event';
  END IF;
  PERFORM pg_advisory_xact_lock(191, 1);
  IF EXISTS (SELECT 1 FROM public.skill_usage_inbox WHERE event_id = v_id) THEN RETURN true; END IF;
  -- All checks precede skill lookup, apply equally to known/unknown IDs, and never ACK loss.
  IF (SELECT count(*) FROM (SELECT 1 FROM public.skill_usage_inbox LIMIT 200000) r) >= 200000
    OR (SELECT count(*) FROM (SELECT 1 FROM public.skill_usage_inbox
      WHERE processed_at IS NULL LIMIT 20000) p) >= 20000
    OR (SELECT count(*) FROM public.skill_usage_inbox
      WHERE declared_skill_id = v_skill AND received_at >= date_trunc('minute', now())) >= 120 THEN
    RETURN false;
  END IF;
  INSERT INTO public.skill_usage_inbox(event_id, declared_skill_id, payload)
    VALUES(v_id, v_skill, p_event);
  RETURN true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION skillpack_receive_skill_usage(jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION skillpack_process_skill_usage() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record; v_org uuid; v_count integer := 0;
BEGIN
  FOR r IN SELECT * FROM public.skill_usage_inbox WHERE processed_at IS NULL
    ORDER BY received_at LIMIT 1000 FOR UPDATE SKIP LOCKED LOOP
    SELECT s.org_id INTO v_org FROM public.skills s
      JOIN public.skill_versions v ON v.skill_id = s.id AND v.org_id = s.org_id
      WHERE s.id = r.declared_skill_id AND v.version = r.payload->>'version' LIMIT 1;
    IF v_org IS NOT NULL THEN
      INSERT INTO public.skill_usage_events(org_id, skill_id, event_id, version,
        kind, adapter, observed_at, agent, environment, declared_user_id, declared_email,
        identity_source, received_at)
      VALUES(v_org, r.declared_skill_id, r.event_id, r.payload->>'version',
        r.payload->>'kind', r.payload->>'adapter', (r.payload->>'observed_at')::timestamptz,
        r.payload->>'agent', r.payload->>'environment', r.payload->'identity'->>'user_id',
        r.payload->'identity'->>'email', r.payload->'identity'->>'source', r.received_at)
      ON CONFLICT DO NOTHING;
    END IF;
    UPDATE public.skill_usage_inbox SET payload = NULL, processed_at = now() WHERE event_id = r.event_id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION skillpack_process_skill_usage() FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION skillpack_expire_skill_usage() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_count integer; v_receipts integer;
BEGIN
  DELETE FROM public.skill_usage_events WHERE (org_id, skill_id, event_id) IN (
    SELECT org_id, skill_id, event_id FROM public.skill_usage_events
    WHERE received_at < now() - interval '90 days' ORDER BY received_at LIMIT 10000
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  DELETE FROM public.skill_usage_inbox WHERE event_id IN (
    SELECT event_id FROM public.skill_usage_inbox WHERE processed_at < now() - interval '8 days'
    ORDER BY processed_at LIMIT 10000
  );
  GET DIAGNOSTICS v_receipts = ROW_COUNT;
  RETURN v_count + v_receipts;
END;
$$;
