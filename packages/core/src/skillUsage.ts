import { sql } from "drizzle-orm";
import { db, type Db } from "@skillpack/db";
import { skillUsageEventSchema, type SkillUsageEvent, type SkillUsageSummary } from "@skillpack/contracts";
import { getSkillBySlug, type ActorContext } from "./services";

export async function receiveSkillUsage(event: SkillUsageEvent, database: Db = db): Promise<boolean> {
  const parsed = skillUsageEventSchema.parse(event);
  const [row] = await database.execute<{ accepted: boolean }>(sql`select public.skillpack_receive_skill_usage(${JSON.stringify(parsed)}::jsonb) as accepted`);
  if (!row) throw new Error("usage receipt unavailable");
  return row.accepted;
}

export async function processSkillUsage(database: Db = db): Promise<number> {
  const [row] = await database.execute<{ count: number }>(sql`select public.skillpack_process_skill_usage() as count`);
  return row?.count ?? 0;
}

export async function expireSkillUsage(database: Db = db): Promise<number> {
  const [row] = await database.execute<{ count: number }>(sql`select public.skillpack_expire_skill_usage() as count`);
  return row?.count ?? 0;
}

/** Caller supplies a tenant transaction; authorization is re-proven before reading any aggregate. */
export async function getSkillUsage(input: {
  actor: ActorContext; orgId: string; slug: string; database: Db;
}): Promise<SkillUsageSummary | null> {
  const skill = await getSkillBySlug(input);
  if (!skill) return null;
  const predicate = sql`org_id = ${input.orgId}::uuid and skill_id = ${skill.id}::uuid
    and received_at >= now() - interval '90 days'`;
  // One statement gives every count the same PostgreSQL snapshot during concurrent ingestion.
  const [result] = await input.database.execute<{ summary: SkillUsageSummary }>(sql`
    with observations as materialized (
      select received_at, kind, adapter, agent, environment, declared_user_id, declared_email, identity_source
      from skill_usage_events where ${predicate}
    ), events as materialized (
      select * from observations where kind = 'invocation'
    ), identities as (
      select declared_user_id as user_id, declared_email as email, identity_source as source,
        count(*)::integer as count
      from events where identity_source is not null
      group by declared_user_id, declared_email, identity_source
      order by count desc, declared_email nulls last, declared_user_id nulls last, identity_source
      limit 501
    )
    select jsonb_build_object(
      'retention_days', 90,
      'total', (select count(*)::integer from events),
      'requests', (select count(*)::integer from observations where kind = 'request'),
      'reads', (select count(*)::integer from observations where kind = 'read'),
      'historical', (select count(*)::integer from observations where kind = 'legacy'),
      'adapters', (select coalesce(jsonb_agg(a order by a.count desc, a.label), '[]'::jsonb) from (
        select adapter as label, count(*)::integer as count from observations where adapter is not null and kind != 'legacy' group by adapter
      ) a),
      'anonymous', (select count(*)::integer from events where identity_source is null),
      'daily', (select coalesce(jsonb_agg(d order by d.label), '[]'::jsonb) from (
        select to_char(received_at at time zone 'UTC', 'YYYY-MM-DD') as label, count(*)::integer as count
        from events group by 1
      ) d),
      'agents', (select coalesce(jsonb_agg(a order by a.count desc, a.label), '[]'::jsonb) from (
        select coalesce(agent, 'unknown') as label, count(*)::integer as count from events group by 1
      ) a),
      'environments', (select coalesce(jsonb_agg(e order by e.count desc, e.label), '[]'::jsonb) from (
        select coalesce(environment, 'unknown') as label, count(*)::integer as count from events group by 1
      ) e),
      'identities', (select coalesce(jsonb_agg(i order by i.count desc, i.email nulls last, i.user_id nulls last, i.source), '[]'::jsonb) from (
        select * from identities order by count desc, email nulls last, user_id nulls last, source limit 500
      ) i),
      'identities_truncated', (select count(*) > 500 from identities)
    ) as summary
  `);
  if (!result) throw new Error("usage statistics unavailable");
  return result.summary;
}
