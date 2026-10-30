import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuthIpAddressHeaders } from "./ip-address";

const execFileAsync = promisify(execFile);
const consume = vi.fn(async () => ({ allowed: true, retryAfter: null }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TEST", "");
  vi.stubEnv("BETTER_AUTH_IP_HEADERS", undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function request(headers: Record<string, string> | Headers = {}) {
  // Import after setting NODE_ENV: Better Auth caches it when the package loads.
  // Inject storage through its public interface; IP resolution/rate limiting are real.
  const { betterAuth } = await import("better-auth");
  const auth = betterAuth({
    baseURL: "https://skillpack.app",
    basePath: "/auth",
    secret: "ip-test-secret-with-at-least-32-characters",
    advanced: { ipAddress: { ipAddressHeaders: betterAuthIpAddressHeaders() } },
    rateLimit: { enabled: true, customStorage: { consume } },
  });
  const response = await auth.handler(new Request("https://skillpack.app/auth/ok", { headers }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
}

function expectBucket(ip: string) {
  expect(consume).toHaveBeenCalledWith(`${ip}|/ok`, expect.objectContaining({ max: expect.any(Number) }));
  expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("could not determine a client IP"));
}

describe("Better Auth client IP rate limiting", () => {
  it("uses Railway's single X-Real-IP even with a forwarded chain and forged vendor headers", async () => {
    await request({
      "x-real-ip": "198.51.100.42",
      "x-forwarded-for": "203.0.113.7, 192.0.2.10",
      "x-vercel-forwarded-for": "203.0.113.8",
      "cf-connecting-ip": "203.0.113.9",
    });
    expectBucket("198.51.100.42");
  });

  it("keeps different Railway client addresses in separate buckets", async () => {
    await request({ "x-real-ip": "198.51.100.42" });
    await request({ "x-real-ip": "198.51.100.43" });
    expectBucket("198.51.100.42");
    expectBucket("198.51.100.43");
  });

  it.each([undefined, "", "   "])("uses the safe default for an unset or blank override (%s)", async (value) => {
    vi.stubEnv("BETTER_AUTH_IP_HEADERS", value);
    await request({ "x-real-ip": "198.51.100.42" });
    expectBucket("198.51.100.42");
  });

  it("normalizes an ordered override and replaces the default headers", async () => {
    vi.stubEnv("BETTER_AUTH_IP_HEADERS", " X-Trusted-Client-IP, X-Another-Client-IP, x-trusted-client-ip ");
    expect(betterAuthIpAddressHeaders()).toEqual(["x-trusted-client-ip", "x-another-client-ip"]);
    await request({
      "x-real-ip": "192.0.2.1",
      "x-trusted-client-ip": "198.51.100.42",
      "x-another-client-ip": "198.51.100.43",
    });
    expectBucket("198.51.100.42");
  });

  it.each(["not a header", ", ,"])("rejects an invalid override at configuration time (%s)", (value) => {
    expect(() => betterAuthIpAddressHeaders(value)).toThrow("BETTER_AUTH_IP_HEADERS");
  });

  it("fails closed and warns once when X-Real-IP is absent or unusable", async () => {
    for (const value of [undefined, "not-an-ip", "198.51.100.42, 192.0.2.10"]) {
      const headers = new Headers({
        "x-forwarded-for": "203.0.113.7",
        "x-vercel-forwarded-for": "203.0.113.8",
      });
      if (value) headers.set("x-real-ip", value);
      await request(headers);
      expect(consume).toHaveBeenCalledWith("no-trusted-ip|/ok", expect.any(Object));
    }
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("could not determine a client IP"));
  });

  it.each(["development", "test"])("retains the no-header localhost fallback in %s", async (environment) => {
    // Separate processes exercise the actual NODE_ENV branches without a cached production import.
    const { stdout, stderr } = await execFileAsync(process.execPath, ["--input-type=module", "-e", `
      import { betterAuth } from "better-auth";
      const auth = betterAuth({
        baseURL: "http://127.0.0.1:3001", basePath: "/auth",
        secret: "ip-test-secret-with-at-least-32-characters",
        advanced: { ipAddress: { ipAddressHeaders: JSON.parse(process.env.TEST_IP_HEADERS) } },
        rateLimit: { enabled: true, customStorage: { consume: async (key) => {
          console.log(key); return { allowed: true, retryAfter: null };
        } } },
      });
      const response = await auth.handler(new Request("http://127.0.0.1:3001/auth/ok"));
      if (response.status !== 200) process.exitCode = 1;
    `], { env: { ...process.env, NODE_ENV: environment, TEST: "", TEST_IP_HEADERS: JSON.stringify(betterAuthIpAddressHeaders()) } });
    expect(stdout.trim()).toBe("127.0.0.1|/ok");
    expect(stderr).not.toContain("could not determine a client IP");
  });
});
