import { describe, expect, it } from "vitest";

import {
  COMPANION_AGENT_OPERATION_REGISTRY,
  matchSkillpackAgentOperation,
} from "../src/agentOperations";

describe("closed Skillpack Agent Auth operation registry", () => {
  it("has one unambiguous definition per method and path", () => {
    const keys = COMPANION_AGENT_OPERATION_REGISTRY.map(({ method, path }) => `${method} ${path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the known parity-sensitive routes least-privileged", () => {
    expect(matchSkillpackAgentOperation("GET", "/skills/demo/download")).toMatchObject({
      capability: "skills:read",
      transport: "rest",
    });
    expect(matchSkillpackAgentOperation("POST", "/skills/demo/install")).toMatchObject({
      capability: "skills:read",
      transport: "rest",
    });
    expect(matchSkillpackAgentOperation("DELETE", "/skills/demo/install")).toMatchObject({
      capability: "skills:read",
      transport: "rest",
    });
    expect(matchSkillpackAgentOperation("GET", "/skills/demo/versions/1.2.3/files/content")).toMatchObject({
      capability: "skills:read",
      transport: "transfer-ticket-download",
    });
    expect(matchSkillpackAgentOperation("GET", "/skills/demo/database/shares")).toMatchObject({
      capability: "database:write",
      sensitive: true,
      transport: "rest",
    });
    expect(matchSkillpackAgentOperation("PUT", "/skills/demo/database/shares")).toMatchObject({
      capability: "database:write",
      sensitive: true,
      transport: "rest",
    });
    expect(matchSkillpackAgentOperation("POST", "/tokens")).toMatchObject({
      capability: "skills:read",
      sensitive: true,
      transport: "rest",
    });
  });

  it("marks package byte routes as ticket-only and rejects arbitrary operations", () => {
    expect(matchSkillpackAgentOperation("POST", "/skills")).toMatchObject({
      transport: "transfer-ticket-upload",
    });
    expect(matchSkillpackAgentOperation("GET", "/skills/demo/versions/1.2.3/package")).toMatchObject({
      transport: "transfer-ticket-download",
    });
    expect(matchSkillpackAgentOperation("GET", "/local-skills/companion/package")).toMatchObject({
      transport: "transfer-ticket-download",
    });
    expect(matchSkillpackAgentOperation("DELETE", "/orgs/current/members/person")).toBeNull();
    expect(matchSkillpackAgentOperation("POST", "/skills/demo/runs")).toBeNull();
  });
});
