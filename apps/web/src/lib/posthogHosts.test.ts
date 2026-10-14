import { describe, expect, it } from "vitest";
import { posthogHosts, posthogRewrites } from "./posthogHosts";

describe("posthogHosts", () => {
  it("keeps the configured PostHog Cloud region for ingestion, assets, and the app", () => {
    expect(posthogHosts("https://us.i.posthog.com")).toEqual({
      ingest: "https://us.i.posthog.com",
      assets: "https://us-assets.i.posthog.com",
      ui: "https://us.posthog.com",
    });
    expect(posthogHosts("https://eu.i.posthog.com/")).toEqual({
      ingest: "https://eu.i.posthog.com",
      assets: "https://eu-assets.i.posthog.com",
      ui: "https://eu.posthog.com",
    });
  });

  it("defaults to US Cloud when the host is unset or malformed", () => {
    expect(posthogHosts(undefined).ingest).toBe("https://us.i.posthog.com");
    expect(posthogHosts("").ingest).toBe("https://us.i.posthog.com");
    expect(posthogHosts("ftp://posthog.example").ingest).toBe("https://us.i.posthog.com");
  });

  it("serves everything from a self-hosted origin", () => {
    expect(posthogHosts("https://posthog.example.com/some/path")).toEqual({
      ingest: "https://posthog.example.com",
      assets: "https://posthog.example.com",
      ui: "https://posthog.example.com",
    });
  });

  it("routes static bundles to the assets host before the catch-all ingestion rewrite", () => {
    expect(posthogRewrites(posthogHosts("https://us.i.posthog.com"))).toEqual([
      { source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/array/:path*", destination: "https://us-assets.i.posthog.com/array/:path*" },
      { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
    ]);
  });
});
