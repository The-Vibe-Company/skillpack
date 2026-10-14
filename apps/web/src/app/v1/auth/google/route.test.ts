/* oxlint-disable anti-slop/no-module-mocking, anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- These route tests predate the incremental anti-slop gate; `server-only` has no test seam and the older cases read untyped fetch calls. */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "./route";

function getRequest(search = "") {
  const url = `https://skillpack.app/v1/auth/google${search}`;
  const request = new Request(url, { method: "GET" });
  return Object.assign(request, { nextUrl: new URL(url) }) as never;
}

describe("google auth route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("re-emits the Better Auth state cookie while redirecting to Google", async () => {
    vi.stubEnv("COMPANION_API_URL", "https://api.skillpack.app");
    vi.stubEnv("COMPANION_WEB_URL", "https://skillpack.app");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc" },
          { headers: { "set-cookie": "__Secure-better-auth.state=abc.signed; Path=/; HttpOnly; Secure; SameSite=Lax" } },
        ),
      ),
    );

    const response = await GET(getRequest("?next=%2Fskills"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://accounts.google.com/o/oauth2/v2/auth?state=abc");
    expect(response.headers.get("set-cookie")).toBe(
      "__Secure-better-auth.state=abc.signed; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://api.skillpack.app/auth/sign-in/social",
      expect.objectContaining({
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/json", origin: "https://skillpack.app" },
      }),
    );
    const call = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(call[1].body as string)).toMatchObject({
      callbackURL: "https://skillpack.app/skills",
      newUserCallbackURL: "https://skillpack.app/skills#signed_up=google&signup_page=%2Flogin",
      errorCallbackURL: "https://skillpack.app/login?error=Google+sign-in+failed.&next=%2Fskills",
    });
  });

  it("preserves a safe public-install return path for new Google users", async () => {
    vi.stubEnv("COMPANION_API_URL", "https://api.skillpack.app");
    vi.stubEnv("COMPANION_WEB_URL", "https://skillpack.app");
    const fetchMock = vi.fn(async () => Response.json({ url: "https://accounts.google.com/authorize" }));
    vi.stubGlobal("fetch", fetchMock);

    await GET(getRequest("?next=%2Fs%2Fpublic-token%3Fdownload%3D1"));

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(call[1].body as string)).toMatchObject({
      callbackURL: "https://skillpack.app/s/public-token?download=1",
      newUserCallbackURL: "https://skillpack.app/s/public-token?download=1#signed_up=google&signup_page=%2Flogin",
      errorCallbackURL: "https://skillpack.app/login?error=Google+sign-in+failed.&next=%2Fs%2Fpublic-token%3Fdownload%3D1",
    });
  });

  it("marks only new Google users, with the page the member signed up from", async () => {
    vi.stubEnv("COMPANION_API_URL", "https://api.skillpack.app");
    vi.stubEnv("COMPANION_WEB_URL", "https://skillpack.app");
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return Response.json({ url: "https://accounts.google.com/authorize" });
      }),
    );

    await GET(getRequest("?next=%2Fjoin%2Finvite-token&signup_page=%2Flogin"));
    await GET(getRequest("?next=%2Fskills&signup_page=https%3A%2F%2Fevil.example%2Fx"));

    expect(JSON.parse(bodies[0] ?? "")).toMatchObject({
      callbackURL: "https://skillpack.app/join/invite-token",
      newUserCallbackURL: "https://skillpack.app/join/invite-token#signed_up=google&signup_page=%2Flogin",
    });
    expect(JSON.parse(bodies[1] ?? "")).toMatchObject({
      newUserCallbackURL: "https://skillpack.app/skills#signed_up=google&signup_page=%2Flogin",
    });
  });

  it("keeps next when Google sign-in is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 503 })));

    const response = await GET(getRequest("?next=%2Fs%2Fpublic-token%3Fdownload%3D1"));

    expect(response.headers.get("location")).toBe(
      "https://skillpack.app/login?error=Google+sign-in+is+unavailable.&next=%2Fs%2Fpublic-token%3Fdownload%3D1",
    );
  });
});
