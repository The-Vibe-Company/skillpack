/** First-party path that proxies PostHog through this origin so blockers do not drop events. */
export const POSTHOG_PROXY_PATH = "/ingest";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const POSTHOG_CLOUD_HOST = /^https:\/\/(us|eu)\.i\.posthog\.com\/?$/;

export interface PostHogHosts {
  /** Event ingestion and flags API. */
  ingest: string;
  /** Static assets: recorder, surveys, and other lazy-loaded bundles. */
  assets: string;
  /** PostHog app origin, used for toolbar and links back to the project. */
  ui: string;
}

/**
 * Resolve the PostHog origins behind the proxy from NEXT_PUBLIC_POSTHOG_HOST. PostHog Cloud keeps its
 * region's assets and app on sibling hosts; a self-hosted instance serves all three from one origin.
 */
export function posthogHosts(host: string | undefined = DEFAULT_POSTHOG_HOST): PostHogHosts {
  const region = POSTHOG_CLOUD_HOST.exec(host.trim())?.[1];
  if (region) {
    return {
      ingest: `https://${region}.i.posthog.com`,
      assets: `https://${region}-assets.i.posthog.com`,
      ui: `https://${region}.posthog.com`,
    };
  }
  try {
    const { origin, protocol } = new URL(host.trim());
    if (protocol === "https:" || protocol === "http:") return { ingest: origin, assets: origin, ui: origin };
  } catch {
    // Fall through to the default region rather than failing the build on a malformed variable.
  }
  return posthogHosts(DEFAULT_POSTHOG_HOST);
}

/** Next.js rewrites for the proxy. Static and array bundles come from the assets host. */
export function posthogRewrites(hosts: PostHogHosts): Array<{ source: string; destination: string }> {
  return [
    { source: `${POSTHOG_PROXY_PATH}/static/:path*`, destination: `${hosts.assets}/static/:path*` },
    { source: `${POSTHOG_PROXY_PATH}/array/:path*`, destination: `${hosts.assets}/array/:path*` },
    { source: `${POSTHOG_PROXY_PATH}/:path*`, destination: `${hosts.ingest}/:path*` },
  ];
}
