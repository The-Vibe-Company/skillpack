export const PRODUCTION_SITE_URL = "https://skillpack.app";

const DEVELOPMENT_SITE_URL = "http://localhost:3000";

/**
 * Public origin used for canonical URLs, Open Graph URLs, robots.txt, and the sitemap.
 * Self-hosted deployments override it with COMPANION_WEB_URL; without an override, production
 * builds resolve to skillpack.app and only development or test fall back to localhost.
 */
export function resolveSiteUrl(
  env: { COMPANION_WEB_URL?: string; NODE_ENV?: string } = process.env,
): URL {
  const configured = env.COMPANION_WEB_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
        return new URL(url.origin);
      }
    } catch {
      // Fall through to the environment default rather than failing every page render.
    }
  }
  return new URL(env.NODE_ENV === "production" ? PRODUCTION_SITE_URL : DEVELOPMENT_SITE_URL);
}
