import { describe, expect, it } from "vitest";
import {
  brandIconCandidates,
  faviconUrl,
  firstLoadableBrandIconCandidate,
  initialDisplayName,
  MAX_ONBOARDING_INVITES,
  normalizeInvite,
  normalizeWebsiteDomain,
  suggestWorkspaceName,
} from "./onboarding";

describe("onboarding brand icon helpers", () => {
  it("normalizes website input to a host", () => {
    expect(normalizeWebsiteDomain("https://Quivr.app/path?utm=1")).toBe("quivr.app");
    expect(normalizeWebsiteDomain("  http://www.Quivr.app/#home  ")).toBe("www.quivr.app");
    expect(normalizeWebsiteDomain("/quivr.app/docs")).toBe("quivr.app");
  });

  it("keeps faviconUrl pointed at icon.horse for the normalized host", () => {
    expect(faviconUrl("https://Quivr.app/docs")).toBe("https://icon.horse/icon/quivr.app");
  });

  it("tries the entered host before the www fallback", () => {
    expect(brandIconCandidates("quivr.app")).toEqual([
      { domain: "quivr.app", url: "https://icon.horse/icon/quivr.app" },
      { domain: "www.quivr.app", url: "https://icon.horse/icon/www.quivr.app" },
    ]);
  });

  it("tries the www host before the naked fallback when www was entered", () => {
    expect(brandIconCandidates("www.quivr.app")).toEqual([
      { domain: "www.quivr.app", url: "https://icon.horse/icon/www.quivr.app" },
      { domain: "quivr.app", url: "https://icon.horse/icon/quivr.app" },
    ]);
  });

  it("returns the first icon candidate that loads", async () => {
    const candidates = brandIconCandidates("quivr.app");
    const attempts: string[] = [];

    await expect(
      firstLoadableBrandIconCandidate(candidates, async (candidate) => {
        attempts.push(candidate.domain);
        return candidate.domain === "www.quivr.app";
      }),
    ).resolves.toEqual({ domain: "www.quivr.app", url: "https://icon.horse/icon/www.quivr.app" });

    expect(attempts).toEqual(["quivr.app", "www.quivr.app"]);
  });

  it("returns null when no icon candidate loads", async () => {
    await expect(firstLoadableBrandIconCandidate(brandIconCandidates("quivr.app"), async () => false)).resolves.toBeNull();
  });
});

describe("onboarding form helpers", () => {
  it("suggests a workspace name from the work email domain", () => {
    expect(suggestWorkspaceName("acme.com")).toBe("Acme");
    expect(suggestWorkspaceName("acme-corp.io")).toBe("Acme-corp");
    expect(suggestWorkspaceName(null)).toBe("");
  });

  it("never pre-fills the name field with an address or an opaque handle", () => {
    expect(initialDisplayName("alex@acme.com", "alex@acme.com")).toBe("");
    expect(initialDisplayName("jordan42", "jordan42@gmail.com")).toBe("");
    expect(initialDisplayName("", "alex@acme.com")).toBe("");
  });

  it("turns an email-derived handle into a name suggestion and keeps chosen names", () => {
    expect(initialDisplayName("alex.rivera", "alex.rivera@acme.com")).toBe("Alex Rivera");
    expect(initialDisplayName("sam", "sam@acme.com")).toBe("Sam");
    expect(initialDisplayName("Alex Rivera", "alex@acme.com")).toBe("Alex Rivera");
  });

  it("accepts a valid invite, lowercased and without a trailing separator", () => {
    expect(normalizeInvite(" Sam@Acme.com, ", { existing: [], selfEmail: "alex@acme.com" })).toEqual({
      ok: true,
      email: "sam@acme.com",
    });
  });

  it("rejects invalid, duplicate, self, and over-limit invites with a visible reason", () => {
    const ctx = { existing: ["sam@acme.com"], selfEmail: "Alex@acme.com" };
    expect(normalizeInvite("not-an-email", ctx)).toEqual({ ok: false, error: "Enter a valid email address." });
    expect(normalizeInvite("SAM@acme.com", ctx)).toMatchObject({ ok: false, error: expect.stringContaining("already on the list") });
    expect(normalizeInvite("alex@acme.com", ctx)).toEqual({ ok: false, error: "You're already a member." });
    const full = Array.from({ length: MAX_ONBOARDING_INVITES }, (_, i) => `p${i}@acme.com`);
    expect(normalizeInvite("new@acme.com", { existing: full, selfEmail: "alex@acme.com" })).toEqual({
      ok: false,
      error: "Up to 50 invitations.",
    });
  });
});
