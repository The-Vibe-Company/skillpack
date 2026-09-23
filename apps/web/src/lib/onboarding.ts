"use client";

import { apiFetch } from "./apiClient";

export interface OnboardingMatchedOrg {
  id: string;
  name: string;
  domain: string;
  memberCount: number;
}

/** Client view of the email-domain classification driving the onboarding flow. */
export interface OnboardingContext {
  email: string;
  domain: string | null;
  isPersonal: boolean;
  matchedOrgs: OnboardingMatchedOrg[];
}

export interface CompleteOnboardingPayload {
  org: { name: string; domain?: string | null; autoJoin: boolean; color?: string | null; logoUrl?: string | null };
  invites: string[];
}

/** `POST /v1/onboarding/join` sets the org cookie and returns the joined workspace. */
export interface JoinOnboardingOrgResponse {
  ok: true;
  orgId: string;
}

/** `POST /v1/onboarding/create`: `invited` lists the addresses that received an invitation. */
export interface CompleteOnboardingResponse {
  ok: true;
  orgId: string;
  invited: string[];
}

/** Join a selected domain-access org for the signed-in user's verified email domain. */
export async function joinByDomain(orgId: string): Promise<JoinOnboardingOrgResponse> {
  return apiFetch("/v1/onboarding/join", { method: "POST", body: JSON.stringify({ orgId }) });
}

/** Create the org, email the invitations, and finish onboarding. `invited` lists who got an invite. */
export async function completeOnboarding(payload: CompleteOnboardingPayload): Promise<CompleteOnboardingResponse> {
  return apiFetch("/v1/onboarding/create", { method: "POST", body: JSON.stringify(payload) });
}

/** Onboarding invitations share the API's cap on `POST /v1/onboarding/create`. */
export const MAX_ONBOARDING_INVITES = 50;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A starting workspace name from a work email domain: `acme-corp.io` → `Acme-corp`. */
export function suggestWorkspaceName(domain: string | null): string {
  const label = domain?.trim().toLowerCase().split(".")[0] ?? "";
  if (!label) return "";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * The name field's starting value. Email signups store the address, or its local part, as the name.
 * That is not a name the member chose, so `alex.rivera` becomes a suggestion (`Alex Rivera`) and
 * anything that still looks like an address or handle starts empty.
 */
export function initialDisplayName(name: string, email: string): string {
  const trimmed = name.trim();
  const address = email.trim().toLowerCase();
  const localPart = address.split("@")[0] ?? "";
  if (!trimmed || trimmed.includes("@") || trimmed.toLowerCase() === address) return "";
  if (trimmed.toLowerCase() !== localPart) return trimmed;
  if (/\d/.test(localPart)) return "";
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export type InviteResult = { ok: true; email: string } | { ok: false; error: string };

/** Validate one typed invite address against the addresses already added and the member's own. */
export function normalizeInvite(
  raw: string,
  { existing, selfEmail }: { existing: readonly string[]; selfEmail: string },
): InviteResult {
  const email = raw.trim().replace(/[,;]+$/, "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (email === selfEmail.trim().toLowerCase()) return { ok: false, error: "You're already a member." };
  if (existing.includes(email)) return { ok: false, error: `${email} is already on the list.` };
  if (existing.length >= MAX_ONBOARDING_INVITES) {
    return { ok: false, error: `Up to ${MAX_ONBOARDING_INVITES} invitations.` };
  }
  return { ok: true, email };
}

export interface BrandIconCandidate {
  domain: string;
  url: string;
}

export type BrandIconLoader = (candidate: BrandIconCandidate) => Promise<boolean>;

/**
 * Best-effort brand-logo URL for a website/domain. The browser loads it directly (icon.horse);
 * if it 404s or is blocked, callers fall back to an initials tile.
 */
export function faviconUrl(domain: string): string {
  const clean = normalizeWebsiteDomain(domain);
  return `https://icon.horse/icon/${clean}`;
}

export function normalizeWebsiteDomain(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\/+/, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
}

export function brandIconCandidates(value: string): BrandIconCandidate[] {
  const clean = normalizeWebsiteDomain(value);
  if (!clean) return [];

  const hosts = [clean];
  if (clean.startsWith("www.")) {
    hosts.push(clean.slice(4));
  } else {
    hosts.push(`www.${clean}`);
  }

  return Array.from(new Set(hosts)).map((domain) => ({ domain, url: faviconUrl(domain) }));
}

export async function firstLoadableBrandIconCandidate(
  candidates: BrandIconCandidate[],
  loadIcon: BrandIconLoader,
): Promise<BrandIconCandidate | null> {
  for (const candidate of candidates) {
    if (await loadIcon(candidate)) return candidate;
  }
  return null;
}
