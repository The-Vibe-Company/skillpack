import { describe, expect, it } from "vitest";
import { patchSetHeaderWithCookieSupport } from "next/dist/server/lib/patch-set-header";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

// Exercise Next's actual response adapter: middleware runs before rendering writes Vary.
function responseWithVary(initial: string | string[]) {
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);
  response.setHeader("Vary", initial);
  patchSetHeaderWithCookieSupport(request, response);
  return response;
}

describe("Next response Vary merging", () => {
  it("preserves middleware Accept and framework cache dimensions across render writes", () => {
    const response = responseWithVary("Accept");
    response.setHeader("Vary", "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch");
    response.setHeader("vary", "RSC, Next-URL");
    expect(String(response.getHeader("vary")).toLowerCase().split(", ").sort()).toEqual([
      "accept", "next-router-prefetch", "next-router-segment-prefetch", "next-router-state-tree", "next-url", "rsc",
    ]);
    response.setHeader("content-type", "text/html");
    expect(response.getHeader("content-type")).toBe("text/html");
  });

  it("merges array values and preserves wildcard semantics", () => {
    const response = responseWithVary(["Accept", "rsc"]);
    response.setHeader("Vary", ["accept", "Next-URL"]);
    expect(String(response.getHeader("vary")).toLowerCase()).toBe("accept, rsc, next-url");
    response.setHeader("Vary", "*");
    response.setHeader("Vary", "Accept");
    expect(response.getHeader("vary")).toBe("*");
  });
});
