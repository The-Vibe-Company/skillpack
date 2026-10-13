-- Catalog moderation is an operator-controlled, API-only surface. Moderation state is kept
-- separate from tenant writes so neither the worker nor an organization member can grant itself
-- moderator authority or change the publication policy.
ALTER TYPE "catalog_submission_status" ADD VALUE 'removed';--> statement-breakpoint

ALTER TABLE "catalog_submissions" DROP CONSTRAINT "catalog_submissions_decision_check";--> statement-breakpoint
ALTER TABLE "catalog_submissions" ADD CONSTRAINT "catalog_submissions_decision_check" CHECK (
  (
    "status"::text = 'proposed'
    AND "decided_by" IS NULL
    AND "decided_at" IS NULL
  )
  OR (
    "status"::text IN ('validated', 'rejected', 'removed')
    AND "decided_by" IS NOT NULL
    AND "decided_at" IS NOT NULL
  )
  OR "status"::text = 'withdrawn'
);--> statement-breakpoint

CREATE TABLE "platform_moderators" (
  "user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE cascade
);--> statement-breakpoint

CREATE TABLE "catalog_publishing_policies" (
  "org_id" uuid PRIMARY KEY REFERENCES "organizations"("id") ON DELETE cascade,
  "banned" boolean DEFAULT false NOT NULL,
  "auto_approve" boolean DEFAULT false NOT NULL
);--> statement-breakpoint

ALTER TABLE "platform_moderators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_moderators" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "platform_moderators_owner_rls" ON "platform_moderators" FOR ALL
  USING (
    current_user = pg_catalog.pg_get_userbyid((
      SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.platform_moderators'::regclass
    ))
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((
      SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.platform_moderators'::regclass
    ))
  );--> statement-breakpoint

ALTER TABLE "catalog_publishing_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "catalog_publishing_policies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "catalog_publishing_policies_owner_rls" ON "catalog_publishing_policies" FOR ALL
  USING (
    current_user = pg_catalog.pg_get_userbyid((
      SELECT relowner FROM pg_catalog.pg_class
      WHERE oid = 'public.catalog_publishing_policies'::regclass
    ))
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((
      SELECT relowner FROM pg_catalog.pg_class
      WHERE oid = 'public.catalog_publishing_policies'::regclass
    ))
  );--> statement-breakpoint

-- The policy projection is pre-tenant: an absent row is the ordinary, unbanned policy.
CREATE FUNCTION public.skillpack_catalog_publishing_policy(p_org uuid)
RETURNS TABLE("banned" boolean, "auto_approve" boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = on
AS $$
  SELECT
    COALESCE(policy."banned", false),
    COALESCE(policy."auto_approve", false)
  FROM (VALUES (p_org)) AS requested("org_id")
  LEFT JOIN public."catalog_publishing_policies" AS policy
    ON policy."org_id" = requested."org_id"
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.skillpack_catalog_publishing_policy(uuid) FROM PUBLIC;--> statement-breakpoint

-- This helper is the only moderation identity check. The configured flag is supplied by the
-- trusted API runtime from its server-side platform-moderator IDs; it is never read from a row
-- controlled by an organization member.
CREATE FUNCTION public.skillpack_is_catalog_moderator(p_actor text, p_configured boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = on
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."user" AS actor
    WHERE actor."id" = p_actor
  )
  AND (
    COALESCE(p_configured, false)
    OR EXISTS (
      SELECT 1
      FROM public."platform_moderators" AS moderator
      WHERE moderator."user_id" = p_actor
    )
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.skillpack_is_catalog_moderator(text, boolean) FROM PUBLIC;--> statement-breakpoint

-- The snapshot is deliberately metadata-only. It is used before an external check provider runs
-- and therefore cannot expose package files, body text, transfer tickets, or other content.
CREATE FUNCTION public.skillpack_catalog_submission_snapshot(p_org uuid, p_submission uuid)
RETURNS TABLE(
  "id" uuid,
  "org_id" uuid,
  "skill_id" uuid,
  "skill_version_id" uuid,
  "package_checksum" text,
  "status" text,
  "kind" text,
  "submitted_by" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = on
AS $$
  SELECT
    submission."id",
    submission."org_id",
    submission."skill_id",
    submission."skill_version_id",
    submission."package_checksum",
    submission."status"::text,
    submission."kind"::text,
    submission."submitted_by"
  FROM public."catalog_submissions" AS submission
  WHERE submission."org_id" = p_org
    AND submission."id" = p_submission
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.skillpack_catalog_submission_snapshot(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Moderators read submissions through the queue projection, but the persisted check report is
-- tenant-owned JSON. Keep this reader narrow: every frozen identity component must match before
-- a report can cross the pre-tenant moderation boundary. The migration-owner RLS policy makes the
-- SECURITY DEFINER read safe while the API role receives only EXECUTE on this exact function.
CREATE FUNCTION public.skillpack_catalog_check_report(
  p_org uuid,
  p_submission uuid,
  p_skill_version uuid,
  p_package_checksum text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = on
AS $$
  SELECT submission."check_report"
  FROM public."catalog_submissions" AS submission
  WHERE submission."org_id" = p_org
    AND submission."id" = p_submission
    AND submission."skill_version_id" = p_skill_version
    AND submission."package_checksum" = p_package_checksum
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.skillpack_catalog_check_report(uuid, uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint

-- Every proposal path takes this lock before its skill lock. The row is materialized lazily so an
-- organization with no explicit policy still participates in the same lock ordering as a banned
-- or auto-approved organization.
CREATE FUNCTION public.skillpack_lock_catalog_publishing(p_org uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = on
AS $$
DECLARE
  v_banned boolean;
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'organization is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public."organizations" AS organization WHERE organization."id" = p_org
  ) THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public."catalog_publishing_policies" ("org_id")
  VALUES (p_org)
  ON CONFLICT ("org_id") DO NOTHING;

  SELECT policy."banned"
  INTO v_banned
  FROM public."catalog_publishing_policies" AS policy
  WHERE policy."org_id" = p_org
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalog publishing policy not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_banned;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.skillpack_lock_catalog_publishing(uuid) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.skillpack_catalog_moderation_queue(
  p_actor text,
  p_configured boolean,
  p_status text,
  p_limit integer,
  p_offset integer
)
RETURNS TABLE(
  "id" uuid,
  "org_id" uuid,
  "skill_id" uuid,
  "skill_version_id" uuid,
  "package_checksum" text,
  "status" text,
  "kind" text,
  "rejection_reason" text,
  "created_at" timestamp with time zone,
  "decided_at" timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = on
AS $$
BEGIN
  IF NOT public.skillpack_is_catalog_moderator(p_actor, p_configured) THEN
    RAISE EXCEPTION 'catalog moderator authorization required'
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50
     OR p_offset IS NULL OR p_offset < 0 OR p_offset > 10000 THEN
    RAISE EXCEPTION 'catalog moderation pagination is out of bounds'
      USING ERRCODE = '22023';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('proposed', 'validated', 'rejected', 'removed') THEN
    RAISE EXCEPTION 'catalog moderation status is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    submission."id",
    submission."org_id",
    submission."skill_id",
    submission."skill_version_id",
    submission."package_checksum",
    submission."status"::text,
    submission."kind"::text,
    submission."rejection_reason",
    submission."created_at",
    submission."decided_at"
  FROM public."catalog_submissions" AS submission
  JOIN public."skills" AS skill
    ON skill."org_id" = submission."org_id"
   AND skill."id" = submission."skill_id"
  WHERE submission."kind"::text = 'submission'
    AND skill."scope"::text = 'org'
    AND submission."status"::text IN ('proposed', 'validated', 'rejected', 'removed')
    AND (p_status IS NULL OR submission."status"::text = p_status)
  ORDER BY submission."created_at" ASC, submission."id" ASC
  LIMIT p_limit OFFSET p_offset;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.skillpack_catalog_moderation_queue(text, boolean, text, integer, integer) FROM PUBLIC;--> statement-breakpoint

-- Moderation is serialized against tenant publication mutations by taking the policy lock first,
-- then the skill lock, then the submission lock. The expected release fields fence the external
-- validation result against a developer-request conversion that races with the provider call.
CREATE FUNCTION public.skillpack_moderate_catalog(
  p_actor text,
  p_configured boolean,
  p_org uuid,
  p_submission uuid,
  p_action text,
  p_reason text,
  p_checks_passed boolean,
  p_automatic boolean,
  p_allowlisted boolean,
  p_expected_version uuid,
  p_expected_checksum text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = on
AS $$
DECLARE
  v_action text := lower(COALESCE(p_action, ''));
  v_policy_banned boolean;
  v_policy_auto_approve boolean;
  v_skill public."skills"%ROWTYPE;
  v_submission public."catalog_submissions"%ROWTYPE;
  v_candidate public."catalog_submissions"%ROWTYPE;
  v_decided_at timestamp with time zone;
  v_new_status text;
  v_scope_skill_id uuid;
  v_was_listed boolean;
BEGIN
  IF v_action NOT IN ('validate', 'reject', 'remove', 'ban') THEN
    RAISE EXCEPTION 'catalog moderation action is invalid' USING ERRCODE = '22023';
  END IF;

  IF v_action IN ('reject', 'remove', 'ban')
     AND (p_reason IS NULL OR btrim(p_reason) = '' OR char_length(p_reason) > 2000) THEN
    RAISE EXCEPTION 'catalog moderation reason is required' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_automatic, false) AND v_action <> 'validate' THEN
    RAISE EXCEPTION 'automatic catalog moderation may only validate'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_automatic, false) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public."user" AS actor WHERE actor."id" = p_actor
    ) THEN
      RAISE EXCEPTION 'catalog moderation actor is not authorized'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.skillpack_is_catalog_moderator(p_actor, p_configured) THEN
    RAISE EXCEPTION 'catalog moderator authorization required'
      USING ERRCODE = '42501';
  END IF;

  IF p_org IS NULL THEN
    RAISE EXCEPTION 'organization is required' USING ERRCODE = '22023';
  END IF;
  IF v_action <> 'ban' AND p_submission IS NULL THEN
    RAISE EXCEPTION 'submission is required' USING ERRCODE = '22023';
  END IF;

  SELECT public.skillpack_lock_catalog_publishing(p_org)
  INTO v_policy_banned;
  SELECT policy."auto_approve"
  INTO v_policy_auto_approve
  FROM public."catalog_publishing_policies" AS policy
  WHERE policy."org_id" = p_org;

  IF v_action = 'ban' THEN
    v_decided_at := clock_timestamp();
  ELSE
    -- Read once only to discover the skill lock key; re-read under the skill lock before changing
    -- the submission so an owner/admin conversion cannot replace the frozen snapshot mid-decision.
    SELECT submission.*
    INTO v_submission
    FROM public."catalog_submissions" AS submission
    WHERE submission."org_id" = p_org
      AND submission."id" = p_submission;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'catalog submission not found' USING ERRCODE = 'P0002';
    END IF;

    SELECT skill.*
    INTO v_skill
    FROM public."skills" AS skill
    WHERE skill."org_id" = p_org
      AND skill."id" = v_submission."skill_id"
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'catalog skill not found' USING ERRCODE = 'P0002';
    END IF;

    SELECT submission.*
    INTO v_submission
    FROM public."catalog_submissions" AS submission
    WHERE submission."org_id" = p_org
      AND submission."id" = p_submission
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'catalog submission not found' USING ERRCODE = 'P0002';
    END IF;
    v_scope_skill_id := v_skill."id";
    v_decided_at := clock_timestamp();
  END IF;

  IF v_action IN ('remove', 'ban') THEN
    IF v_action = 'remove' THEN
      IF v_submission."status"::text <> 'validated'
         OR v_skill."scope"::text <> 'org' THEN
        RAISE EXCEPTION 'only a validated catalog submission can be removed'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    -- Ban walks every skill in id order; remove walks only the target skill. Both paths share the
    -- same transition fence so proposed and validated rows cannot be resurrected independently.
    FOR v_skill IN
      SELECT skill.*
      FROM public."skills" AS skill
      WHERE skill."org_id" = p_org
        AND skill."scope"::text = 'org'
        AND (v_action = 'ban' OR skill."id" = v_scope_skill_id)
      ORDER BY skill."id"
      FOR UPDATE
    LOOP
      v_was_listed := v_skill."listed_publicly" OR v_skill."listed_at" IS NOT NULL;
      IF v_was_listed THEN
        UPDATE public."skills"
        SET "listed_publicly" = false,
            "listed_at" = NULL,
            "updated_at" = v_decided_at
        WHERE "org_id" = p_org AND "id" = v_skill."id";

        INSERT INTO public."audit_log"(
          "org_id", "actor_id", "action", "target_type", "target_id", "metadata"
        ) VALUES (
          p_org,
          p_actor,
          'skill.public_listing.clear',
          'skill',
          v_skill."id"::text,
          jsonb_build_object(
            'automatic', false,
            'reason', p_reason,
            'organization_banned', v_action = 'ban'
          )
        );
      END IF;

      FOR v_candidate IN
        SELECT submission.*
        FROM public."catalog_submissions" AS submission
        WHERE submission."org_id" = p_org
          AND submission."skill_id" = v_skill."id"
          AND submission."status"::text IN ('proposed', 'validated')
        ORDER BY submission."id"
        FOR UPDATE
      LOOP
        v_new_status := CASE
          WHEN v_candidate."status"::text = 'proposed' THEN 'rejected'
          ELSE 'removed'
        END;

        UPDATE public."catalog_submissions"
        SET "status" = v_new_status::public.catalog_submission_status,
            "decided_by" = p_actor,
            "decided_at" = v_decided_at,
            "rejection_reason" = p_reason
        WHERE "org_id" = p_org AND "id" = v_candidate."id";

        INSERT INTO public."audit_log"(
          "org_id", "actor_id", "action", "target_type", "target_id", "metadata"
        ) VALUES (
          p_org,
          p_actor,
          'catalog_submission.' || v_new_status,
          'catalog_submission',
          v_candidate."id"::text,
          jsonb_build_object(
            'automatic', false,
            'skillId', v_candidate."skill_id",
            'releaseVersionId', v_candidate."skill_version_id",
            'kind', v_candidate."kind"::text,
            'status', v_new_status,
            'reason', p_reason
          )
        );
      END LOOP;
    END LOOP;

    IF v_action = 'ban' THEN
      UPDATE public."catalog_publishing_policies"
      SET "banned" = true
      WHERE "org_id" = p_org;

      INSERT INTO public."audit_log"(
        "org_id", "actor_id", "action", "target_type", "target_id", "metadata"
      ) VALUES (
        p_org,
        p_actor,
        'organization.catalog_publishing.banned',
        'organization',
        p_org::text,
        jsonb_build_object('automatic', false, 'reason', p_reason)
      );
    END IF;
    RETURN;
  END IF;

  IF v_action = 'validate' THEN
    IF v_policy_banned THEN
      RAISE EXCEPTION 'catalog publishing is banned for this organization'
        USING ERRCODE = '23514';
    END IF;
    IF v_submission."status"::text <> 'proposed'
       OR v_submission."kind"::text <> 'submission'
       OR v_skill."scope"::text <> 'org'
       OR v_skill."archived_at" IS NOT NULL
       OR v_skill."public_version_id" IS NULL
       OR v_skill."public_package_checksum" IS NULL
       OR v_skill."public_package_size_bytes" IS NULL
       OR v_skill."public_released_at" IS NULL THEN
      RAISE EXCEPTION 'only an active proposed catalog submission can be validated'
        USING ERRCODE = '23514';
    END IF;
    IF p_expected_version IS NULL
       OR p_expected_checksum IS NULL
       OR v_submission."skill_version_id" IS DISTINCT FROM p_expected_version
       OR v_submission."package_checksum" IS DISTINCT FROM p_expected_checksum THEN
      RAISE EXCEPTION 'catalog submission release changed during validation'
        USING ERRCODE = '23514';
    END IF;
    IF p_checks_passed IS NOT TRUE THEN
      RAISE EXCEPTION 'catalog checks did not pass' USING ERRCODE = '23514';
    END IF;
    IF COALESCE(p_automatic, false)
       AND NOT (
         COALESCE(v_policy_auto_approve, false)
         OR COALESCE(p_allowlisted, false)
       ) THEN
      RAISE EXCEPTION 'automatic catalog validation is not enabled'
        USING ERRCODE = '42501';
    END IF;
    IF COALESCE(p_automatic, false)
       AND v_submission."submitted_by" IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION 'automatic validation actor does not own the submission'
        USING ERRCODE = '42501';
    END IF;

    UPDATE public."catalog_submissions"
    SET "status" = 'validated'::public.catalog_submission_status,
        "decided_by" = p_actor,
        "decided_at" = v_decided_at,
        "rejection_reason" = NULL
    WHERE "org_id" = p_org AND "id" = p_submission;

    UPDATE public."skills"
    SET "listed_publicly" = true,
        "listed_at" = v_decided_at,
        "updated_at" = v_decided_at
    WHERE "org_id" = p_org AND "id" = v_skill."id";

    INSERT INTO public."audit_log"(
      "org_id", "actor_id", "action", "target_type", "target_id", "metadata"
    ) VALUES (
      p_org,
      p_actor,
      'catalog_submission.validated',
      'catalog_submission',
      p_submission::text,
      jsonb_build_object(
        'automatic', COALESCE(p_automatic, false),
        'skillId', v_submission."skill_id",
        'releaseVersionId', v_submission."skill_version_id",
        'kind', v_submission."kind"::text,
        'status', 'validated'
      )
    );

    INSERT INTO public."audit_log"(
      "org_id", "actor_id", "action", "target_type", "target_id", "metadata"
    ) VALUES (
      p_org,
      p_actor,
      'skill.public_listing.set',
      'skill',
      v_skill."id"::text,
      jsonb_build_object(
        'automatic', COALESCE(p_automatic, false),
        'submissionId', p_submission,
        'releaseVersionId', v_submission."skill_version_id"
      )
    );
    RETURN;
  END IF;

  IF v_action = 'reject' THEN
    IF v_submission."status"::text <> 'proposed'
       OR v_submission."kind"::text <> 'submission'
       OR v_skill."scope"::text <> 'org' THEN
      RAISE EXCEPTION 'only a proposed catalog submission can be rejected'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public."catalog_submissions"
    SET "status" = 'rejected'::public.catalog_submission_status,
        "decided_by" = p_actor,
        "decided_at" = v_decided_at,
        "rejection_reason" = p_reason
    WHERE "org_id" = p_org AND "id" = p_submission;

    INSERT INTO public."audit_log"(
      "org_id", "actor_id", "action", "target_type", "target_id", "metadata"
    ) VALUES (
      p_org,
      p_actor,
      'catalog_submission.rejected',
      'catalog_submission',
      p_submission::text,
      jsonb_build_object(
        'automatic', false,
        'skillId', v_submission."skill_id",
        'releaseVersionId', v_submission."skill_version_id",
        'kind', v_submission."kind"::text,
        'status', 'rejected',
        'reason', p_reason
      )
    );
    RETURN;
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.skillpack_moderate_catalog(
  text, boolean, uuid, uuid, text, text, boolean, boolean, boolean, uuid, text
) FROM PUBLIC;
