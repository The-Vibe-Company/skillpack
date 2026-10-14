import { z } from "zod";

/**
 * A completed signup is announced to the next page load through a URL fragment. Fragments never reach
 * the server and survive its redirects (for example `/skills` → `/onboarding`), so the marker arrives
 * wherever the new member lands. It carries no identity: the landing page reads that from the session.
 */
const signupMethod = z.enum(["email", "google"]);
export type SignupMethod = z.infer<typeof signupMethod>;

export interface SignupMarker {
  method: SignupMethod;
  /** Pathname of the page where the member signed up. */
  signupPage: string;
}

const METHOD_KEY = "signed_up";
const PAGE_KEY = "signup_page";
/** Tab-scoped flag set by the login form, so a shared or crafted link cannot report a signup. */
const ARMED_KEY = "skillpack:signup-armed";

/** A same-origin pathname, or null. Query and fragment are dropped: only the page is reported. */
export function signupPagePath(value: string | null): string | null {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }
  try {
    const parsed = new URL(value, "http://skillpack.local");
    return parsed.origin === "http://skillpack.local" ? parsed.pathname : null;
  } catch {
    return null;
  }
}

/**
 * Append the marker to a same-origin path or absolute URL. A destination that already has a fragment
 * keeps it: losing the member's place matters more than one analytics event.
 */
export function withSignupMarker(destination: string, marker: SignupMarker): string {
  if (destination.includes("#")) return destination;
  const params = new URLSearchParams({ [METHOD_KEY]: marker.method, [PAGE_KEY]: marker.signupPage });
  return `${destination}#${params.toString()}`;
}

/**
 * Called by the login form right before it leaves for a signup completion (OTP redirect or Google).
 * sessionStorage stays with the tab across the Google round trip. Storage is passed as a getter because
 * merely reading `window.sessionStorage` throws where site storage is blocked; the signup then simply
 * goes unreported.
 */
export function armSignupMarker(storage: () => Pick<Storage, "setItem">): void {
  try {
    storage().setItem(ARMED_KEY, "1");
  } catch {
    // Private modes may refuse storage; analytics is best-effort.
  }
}

/** Read and clear the flag. Every page load consumes it, so it never outlives the next landing. */
export function takeSignupArming(storage: () => Pick<Storage, "getItem" | "removeItem">): boolean {
  try {
    const store = storage();
    const armed = store.getItem(ARMED_KEY) === "1";
    store.removeItem(ARMED_KEY);
    return armed;
  } catch {
    return false;
  }
}

/** Parse a marker from `location.hash`. Anything else in the fragment means it is not ours. */
export function readSignupMarker(hash: string): SignupMarker | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const method = signupMethod.safeParse(params.get(METHOD_KEY));
  if (!method.success) return null;
  if ([...params.keys()].some((key) => key !== METHOD_KEY && key !== PAGE_KEY)) return null;
  return { method: method.data, signupPage: signupPagePath(params.get(PAGE_KEY)) ?? "/login" };
}
