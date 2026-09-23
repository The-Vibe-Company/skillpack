import type { LocalSkillRow } from "@skillpack/contracts";

export function promptFor(skill: LocalSkillRow): string {
  if (skill.status === "update") return skill.prompts.update;
  if (skill.status === "installed") return skill.prompts.use;
  return skill.prompts.install;
}

/** Fill non-secret prompt placeholders without minting or injecting an API key. */
export function fillPrompt(
  template: string,
  base: string,
  workspaceId: string,
  agent = "<your assistant>",
  tool = agent,
): string {
  return template
    .split("{base}")
    .join(base)
    .split("{workspaceId}")
    .join(workspaceId)
    .split("{tool}")
    .join(tool)
    .split("{token}")
    .join("[API key intentionally omitted; use SKILLPACK_API_KEY or hidden auth login]")
    .split("<your assistant>")
    .join(agent);
}

/**
 * The guided-setup prompt: install + connect + local and org review before the Skillpack skill is
 * installed, then the shorter resume prompt that picks up the first unfinished step.
 */
export function gettingStartedTemplate(skill: LocalSkillRow, installed: boolean): string {
  return installed ? skill.prompts.resume : skill.prompts.onboarding;
}
