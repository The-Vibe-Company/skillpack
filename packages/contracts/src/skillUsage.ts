import { z } from "zod";
import { SEMVER_RE } from "./frontmatter";

export const skillUsageEventSchema = z.object({
  schema_version: z.literal(1),
  kind: z.enum(["invocation", "request", "read"]),
  adapter: z.enum(["claude-hook", "claude-transcript", "codex-hook", "codex-transcript", "opencode-plugin"]),
  observed_at: z.string().datetime({ offset: true }),
  event_id: z.string().uuid(),
  skill_id: z.string().uuid(),
  version: z.string().max(128).regex(SEMVER_RE),
  agent: z.enum(["claude-code", "codex", "opencode", "pi", "other"]).optional(),
  environment: z.enum(["conductor", "ci", "sandbox", "local", "other"]).optional(),
  identity: z.object({
    user_id: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_.:@-]+$/).optional(),
    email: z.string().trim().max(254).email().transform((value) => value.toLowerCase()).optional(),
    source: z.enum(["configured", "skillpack-local", "git-local", "git-global"]),
  }).strict().refine((value) => Boolean(value.user_id || value.email), "identity requires an ID or email").optional(),
}).strict();
export type SkillUsageEvent = z.infer<typeof skillUsageEventSchema>;

export interface SkillUsageCount { label: string; count: number }
export interface SkillUsageSummary {
  retention_days: number;
  total: number;
  anonymous: number;
  requests: number;
  reads: number;
  historical: number;
  adapters: SkillUsageCount[];
  daily: SkillUsageCount[];
  agents: SkillUsageCount[];
  environments: SkillUsageCount[];
  identities: { user_id: string | null; email: string | null; source: string; count: number }[];
  identities_truncated: boolean;
}
