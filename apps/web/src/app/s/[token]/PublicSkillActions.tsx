"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { PublicReleasePreview } from "./preview";

function publicPackageUrl(token: string, version: string): string {
  return `/v1/public/skills/${encodeURIComponent(token)}/versions/${encodeURIComponent(version)}/package`;
}

export function buildPublicInstallPrompt(input: {
  origin: string;
  token: string;
  slug: string;
  release: PublicReleasePreview;
}): string {
  const { origin, token, slug, release } = input;
  const apiBase = `${origin.replace(/\/$/, "")}/v1`;
  return `Install the public Skillpack skill ${slug}@${release.version} from ${origin}.

Authenticate with an API key that has the exact public-skills:install scope:
1. Human setup: \`skillpack auth login --api-url ${apiBase}\` (the key is read through hidden terminal input).
2. Automation: set SKILLPACK_API_KEY and SKILLPACK_API_URL=${apiBase} in the process environment.
3. Verify with \`skillpack auth status --json\`; require an active, unexpired key with public-skills:install
   for the intended workspace. Never put the API key in this prompt, chat, argv, source, or logs.

Use the exact native command after asking for the destination and selected tools:
\`skillpack install --public ${token} --version ${release.version} --scope project --tools <selected> --api-url ${apiBase} --json\`
Use \`--scope user\` only when the user explicitly requests a user-wide install. This command is root-only:
it installs this reviewed public package, preserves the declared prerequisite list as warnings, and does not
resolve dependencies, retrieve secrets, or submit an install report.

Before writing anything:
1. Confirm the reviewed release is still ${slug}@${release.version}, SHA-256 ${release.checksum}, exactly ${release.size_bytes} bytes.
2. Let the native CLI verify the server metadata and package digest. Reject a changed version, checksum, or size.
3. Use the requested compatible target (Claude Code, Codex, OpenCode, Grok Bot, OpenClaw, or Hermes), then show
   the resolved destination. Ask only for a missing target or scope choice. Hermes is global-only. If the
   destination exists and replacement was not already authorized, ask before replacing it.
4. Preserve declared prerequisites in the result and tell the user what still needs attention. Do not fetch
   dependency packages, secrets, or configuration as part of this public root install.

If the native CLI is missing, use the official runtime-v0.2.0 HTTPS installers:
- POSIX: download install.sh and the adjacent SHA256SUMS from https://github.com/The-Vibe-Company/skillpack/releases/download/runtime-v0.2.0/, verify install.sh against its SHA256SUMS entry, then run sh install.sh.
- Windows PowerShell: download install.ps1 and the adjacent SHA256SUMS from that URL, compare Get-FileHash .\\install.ps1 -Algorithm SHA256 with its entry, then run the script.
The installer independently verifies the pinned archive digest. Never run an installer or archive whose checksum differs from release metadata.

Finish by reporting ${slug}@${release.version}, the destination, and declared prerequisites. Never print credentials.`;
}

export function PublicSkillActions({
  token,
  slug,
  release,
  authenticated,
  startDownload = false,
}: {
  token: string;
  slug: string;
  release: PublicReleasePreview | null;
  authenticated: boolean;
  startDownload?: boolean;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const downloadStarted = useRef(false);
  const packageUrl = release ? publicPackageUrl(token, release.version) : null;
  const returnPath = `/s/${encodeURIComponent(token)}?download=1`;
  const loginHref = `/login?next=${encodeURIComponent(returnPath)}`;

  const prompt = useMemo(() => {
    const origin = globalThis.location?.origin;
    if (!release || !origin) return null;
    return buildPublicInstallPrompt({ origin, token, slug, release });
  }, [release, slug, token]);

  useEffect(() => {
    if (!startDownload || !authenticated || !packageUrl || downloadStarted.current) return;
    downloadStarted.current = true;
    // Keep the stable public page mounted after the browser starts the transfer. Removing the query
    // flag prevents refresh/back from downloading a second copy.
    window.history.replaceState(window.history.state, "", `/s/${encodeURIComponent(token)}`);
    window.location.assign(packageUrl);
  }, [authenticated, packageUrl, startDownload, token]);

  const copyPrompt = async () => {
    if (!prompt || !navigator.clipboard) {
      setCopyState("error");
      return;
    }
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2200);
    } catch {
      setCopyState("error");
    }
  };

  if (!release) {
    return (
      <div className="spreview__release-empty" role="status">
        <Icon name="lock" size={15} />
        <div>
          <strong>No public release</strong>
          <span>The creator has not made a package available for installation.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="spreview__install">
      <div className="spreview__actions" aria-label="Install this skill">
        <button
          type="button"
          className="btn-primary spreview__cta"
          onClick={copyPrompt}
          disabled={copyState === "copying"}
        >
          <Icon name={copyState === "copied" ? "check" : "copy"} size={15} />
          {copyState === "copying"
            ? "Copying..."
            : copyState === "copied"
              ? "Install prompt copied"
              : "Copy install prompt"}
        </button>
        {authenticated ? (
          <a className="btn-sec spreview__cta" href={packageUrl ?? undefined} download>
            <Icon name="download" size={15} />
            Download ZIP
          </a>
        ) : (
          <Link className="btn-sec spreview__cta" href={loginHref}>
            <Icon name="log-in" size={15} />
            Sign in to download
          </Link>
        )}
      </div>
      <p className={`spreview__action-note${copyState === "error" ? " is-error" : ""}`} role="status" aria-live="polite">
        {copyState === "error"
          ? "Could not copy the prompt. Check browser clipboard access and try again."
          : authenticated
            ? "The ZIP is pinned to the public release shown above."
            : "Native installs use an API key with public-skills:install. Direct downloads require a Skillpack account."}
      </p>
    </div>
  );
}
