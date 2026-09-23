import { skillRuntimeUsageSchema } from "@skillpack/contracts";

const START = "<!-- skillpack:usage:start -->";
const END = "<!-- skillpack:usage:end -->";

/** Replace only the generated leading block; authored marker examples remain literal. */
export function withSkillUsageInstructions(body: string, input: {
  skillId: string;
  version: string;
  instanceUrl: string;
}): string {
  const url = new URL(input.instanceUrl);
  const usage = skillRuntimeUsageSchema.parse({ schemaVersion: 1,
    skillId: input.skillId, version: input.version, origin: url.origin });
  if (url.username || url.password) throw new Error("Skill usage origin cannot contain credentials");
  let clean = body.trimStart();
  while (clean.startsWith(START)) {
    const end = clean.indexOf(END, START.length);
    if (end < 0) throw new Error("Unclosed Skillpack usage instruction block");
    clean = clean.slice(end + END.length).trimStart();
  }
  return `${START}
## Skillpack runtime

Usage is observed locally by skillpack-runtime when installed through Skillpack. Package: ${usage.skillId}@${usage.version}, origin: ${usage.origin}.
Do not send activation reports, run tracking commands, or install hooks during this skill's execution. Setup and updates belong to Skillpack. Continue the task when collection is unavailable. SKILLPACK_TELEMETRY=0 disables collection for this session.
${END}

${clean.trim()}`;
}
