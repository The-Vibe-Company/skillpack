import { expireSkillUsage, processSkillUsage } from "@skillpack/core";
import type { Supervisor } from "./billingSupervisor";

/** Bounded batches every five seconds; reads hide expired reports immediately even during downtime. */
export function startSkillUsageCleanup(input: {
  expire?: () => Promise<number>; process?: () => Promise<number>; intervalMs?: number;
} = {}): Supervisor {
  let stopping = false;
  let active: Promise<void> | null = null;
  const run = () => {
    if (stopping || active) return;
    active = (async () => {
      await (input.process ?? processSkillUsage)();
      await (input.expire ?? expireSkillUsage)();
    })().then(() => undefined, () => {
      // Do not log database exceptions: usage rows can contain declared email addresses.
      console.error("skill usage retention sweep failed");
    }).finally(() => { active = null; });
  };
  run();
  const timer = setInterval(run, input.intervalMs ?? 5_000);
  return { async stop() { stopping = true; clearInterval(timer); await active; } };
}
