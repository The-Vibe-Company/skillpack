import { describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { authLoginRequest } from "./authLoginRequest";

describe("form login request adaptation", () => {
  it.each(["signin", "signup"] as const)("preserves ingress headers and replaces the form body for %s", async (mode) => {
    const incoming = new Request("https://api.thecompanion.sh/v1/auth/login-redirect", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": "12",
        "x-real-ip": "198.51.100.42",
        "x-custom-client-ip": "198.51.100.43",
        "x-forwarded-for": "203.0.113.7, 192.0.2.10",
        origin: "https://skillpack.app",
      },
    });
    const adapted = authLoginRequest(incoming, {
      mode, email: "invalid", password: "password", name: "Test", fallbackOrigin: "https://fallback.example.test",
    });
    expect(new URL(adapted.url).pathname).toBe(mode === "signup" ? "/auth/sign-up/email" : "/auth/sign-in/email");
    expect(adapted.headers.get("content-type")).toBe("application/json");
    expect(adapted.headers.has("content-length")).toBe(false);
    expect(adapted.headers.get("origin")).toBe("https://skillpack.app");
    expect(adapted.headers.get("x-real-ip")).toBe("198.51.100.42");
    expect(adapted.headers.get("x-custom-client-ip")).toBe("198.51.100.43");
    expect(adapted.headers.get("x-forwarded-for")).toBe("203.0.113.7, 192.0.2.10");
    expect(await adapted.clone().json()).toEqual({ email: "invalid", password: "password", name: "Test" });
    expect(incoming.headers.get("content-type")).toBe("application/x-www-form-urlencoded");

    const consume = vi.fn(async () => ({ allowed: true, retryAfter: null }));
    const auth = betterAuth({
      baseURL: "https://api.thecompanion.sh", basePath: "/auth",
      secret: "ip-test-secret-with-at-least-32-characters",
      emailAndPassword: { enabled: true },
      advanced: { ipAddress: { ipAddressHeaders: ["x-real-ip"] } },
      rateLimit: { enabled: true, customStorage: { consume } },
    });
    // Invalid email stops before database access, after the actual rate limiter consumes its key.
    expect((await auth.handler(adapted)).status).toBe(400);
    expect(consume).toHaveBeenCalledWith(`198.51.100.42|${new URL(adapted.url).pathname.slice(5)}`, expect.any(Object));
  });

  it("retains the configured fallback origin when the form has no Origin header", () => {
    const adapted = authLoginRequest(new Request("https://api.thecompanion.sh/v1/auth/login-redirect"), {
      mode: "signin", email: "person@example.test", password: "password", name: "Test", fallbackOrigin: "https://skillpack.app",
    });
    expect(adapted.headers.get("origin")).toBe("https://skillpack.app");
  });
});
