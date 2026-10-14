import { describe, expect, it } from "vitest";
import { armSignupMarker, readSignupMarker, signupPagePath, takeSignupArming, withSignupMarker } from "./signupMarker";

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

function refusingStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const refuse = () => {
    throw new Error("SecurityError: storage is disabled");
  };
  return { getItem: refuse, setItem: refuse, removeItem: refuse };
}

describe("signup marker", () => {
  it("round-trips the method and signup page through a URL fragment", () => {
    const url = withSignupMarker("https://skillpack.app/skills?lib=mine", { method: "google", signupPage: "/login" });
    expect(url).toBe("https://skillpack.app/skills?lib=mine#signed_up=google&signup_page=%2Flogin");
    expect(readSignupMarker(new URL(url).hash)).toEqual({ method: "google", signupPage: "/login" });
  });

  it("keeps a destination's own fragment instead of replacing it", () => {
    expect(withSignupMarker("/settings#profile", { method: "email", signupPage: "/login" })).toBe("/settings#profile");
  });

  it.each(["", "#", "#profile", "#signed_up=github", "#signed_up=email&next=%2Fx"])(
    "ignores fragment %s that is not a signup marker",
    (hash) => {
      expect(readSignupMarker(hash)).toBeNull();
    },
  );

  it("arms one landing page per login-form navigation", () => {
    const storage = memoryStorage();
    expect(takeSignupArming(() => storage)).toBe(false);

    armSignupMarker(() => storage);

    expect(takeSignupArming(() => storage)).toBe(true);
    expect(takeSignupArming(() => storage)).toBe(false);
  });

  it("treats unavailable storage as unarmed instead of failing the page", () => {
    const storage = refusingStorage();
    expect(() => armSignupMarker(() => storage)).not.toThrow();
    expect(takeSignupArming(() => storage)).toBe(false);
    const blocked = () => {
      throw new Error("SecurityError: access to sessionStorage is denied");
    };
    expect(() => armSignupMarker(blocked)).not.toThrow();
    expect(takeSignupArming(blocked)).toBe(false);
  });

  it("reports only a same-origin pathname as the signup page", () => {
    expect(signupPagePath("/login?mode=signup#x")).toBe("/login");
    expect(signupPagePath("//evil.example/login")).toBeNull();
    expect(signupPagePath("https://evil.example/login")).toBeNull();
    expect(signupPagePath("/\\evil")).toBeNull();
    expect(signupPagePath(null)).toBeNull();
    expect(readSignupMarker("#signed_up=email&signup_page=https%3A%2F%2Fevil.example")).toEqual({
      method: "email",
      signupPage: "/login",
    });
  });
});
