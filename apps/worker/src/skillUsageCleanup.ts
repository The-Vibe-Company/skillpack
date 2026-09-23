import { expireSkillUsage } from "@skillpack/core";
import type { Supervisor } from "./billingSupervisor";

/** Bounded batches every minute; reads hide expired reports immediately even during downtime. */
export function startSkillUsageCleanup(input: {
  expire?: () => Promise<number>; intervalMs?: number;
} = {}): Supervisor {
  let stopping = false;
  let active: Promise<void> | null = null;
  const run = () => {
    if (stopping || active) return;
    active = (input.expire ?? expireSkillUsage)().then(() => undefined, () => {
      // Do not log database exceptions: usage rows can contain declared email addresses.
      console.error("skill usage retention sweep failed");
    }).finally(() => { active = null; });
  };
  run();
  const timer = setInterval(run, input.intervalMs ?? 60_000);
  return { async stop() { stopping = true; clearInterval(timer); await active; } };
}
