"use client";

import { useEffect } from "react";
import { analytics, type AnalyticsUser } from "@/lib/analytics";

/** Attach this browser's analytics to the signed-in member, including after a logout reset. */
export function AnalyticsIdentity({ user }: { user: AnalyticsUser }) {
  // The layout re-renders with a fresh object; depend on the values so identify runs only on change.
  const { userId, email } = user;
  const orgId = user.org?.org_id ?? null;
  const orgName = user.org?.name ?? null;
  useEffect(() => {
    if (!analytics.init()) return;
    const org = orgId === null || orgName === null ? null : { org_id: orgId, name: orgName };
    analytics.identify({ userId, email, org });
  }, [userId, email, orgId, orgName]);
  return null;
}
