import { describe, expect, it } from "vitest";
import { HOME_DESCRIPTION, HOME_TITLE } from "@/lib/siteMetadata";
import { metadata } from "./layout";

/**
 * Product promise:
 * /login is the sign-up conversion page, so search and social results describe creating a
 * workspace instead of repeating the home page's copy, and the page stays indexable.
 *
 * Regression caught:
 * /login inherited the root layout's title, description and og:title verbatim, so Search Console
 * saw the home copy on the only conversion page (5 impressions, 0 clicks, position 8.4).
 *
 * Why this test is route-level:
 * The promise is the route metadata Next serializes into <head>, not any login UI behavior.
 *
 * Failure proof:
 * Deleting the metadata export, dropping `absolute` (which re-appends " · Skillpack"), restoring
 * the home copy, or adding a noindex robots directive fails an assertion below.
 */

const TITLE = "Sign Up for Skillpack: Share Agent Skills With Your Team";
const DESCRIPTION =
  "Create a free Skillpack workspace to publish SKILL.md agent skills, share them with your team and install them in Claude Code, Codex or OpenCode.";

describe("/login search metadata", () => {
  it("titles the sign-up page itself instead of inheriting the home title", () => {
    expect(metadata.title).toEqual({ absolute: TITLE });
  });

  it("describes creating a workspace instead of repeating the home description", () => {
    expect(metadata.description).toBe(DESCRIPTION);
    expect(metadata.description).not.toBe(HOME_DESCRIPTION);
  });

  it("carries the sign-up copy on the Open Graph and Twitter cards too", () => {
    expect(metadata.openGraph?.title).toBe(TITLE);
    expect(metadata.openGraph?.description).toBe(DESCRIPTION);
    expect(metadata.openGraph?.url).toBe("/login");
    expect(metadata.twitter?.title).toBe(TITLE);
    expect(metadata.twitter?.description).toBe(DESCRIPTION);
  });

  it("repeats none of the home page's search copy", () => {
    const social = [metadata.openGraph?.title, metadata.twitter?.title];
    expect(social).not.toContain(HOME_TITLE);
  });

  it("stays indexable and inherits the root layout's self-referencing canonical", () => {
    // The root layout's path-relative "./" canonical resolves to /login for this route.
    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates).toBeUndefined();
  });

  it("keeps both search snippets inside the lengths Google renders", () => {
    expect(TITLE.length).toBeLessThanOrEqual(60);
    expect(DESCRIPTION.length).toBeLessThanOrEqual(160);
  });
});
