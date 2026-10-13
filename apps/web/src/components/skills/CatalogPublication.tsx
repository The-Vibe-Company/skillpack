"use client";

import { useEffect, useState } from "react";
import { isCatalogLicense } from "@/lib/publicCatalog";
import {
  fetchCatalogPublishedVersion,
  fetchSkillPublicListing,
  requestSkillPublicListing,
  setSkillPublicListing,
  type SkillPublicListingStatus,
} from "@/lib/queries";
import type { SkillVM } from "@/lib/types";
import { Icon } from "../Icon";

/** Present only when `SKILLPACK_PUBLIC_CATALOG` is on; the slug names the selected workspace. */
export interface PublicReleaseCatalog {
  orgSlug: string;
}

export type CatalogPhase = "unpublished" | "requested" | "proposed" | "published" | "rejected" | "removed";

/**
 * Discovery wins over submission history: a listed skill keeps serving its validated snapshot
 * while a newer submission is proposed or rejected. A validated-but-unlisted or withdrawn latest
 * submission means the skill was unpublished or its review was abandoned.
 */
export function catalogPhase(status: SkillPublicListingStatus): CatalogPhase {
  const latest = status.latest_submission;
  if (status.listed_publicly) return "published";
  if (!latest) return "unpublished";
  if (latest.status === "proposed") return latest.kind === "publish_request" ? "requested" : "proposed";
  if (latest.status === "rejected") return "rejected";
  return "removed";
}

const PHASE_BADGE = {
  unpublished: { label: "Not published", tone: "" },
  requested: { label: "Requested", tone: "badge--warn" },
  proposed: { label: "Proposed", tone: "badge--accent" },
  published: { label: "Published", tone: "badge--ok" },
  rejected: { label: "Rejected", tone: "catalog-pub__badge--danger" },
  removed: { label: "Removed", tone: "" },
} satisfies Record<CatalogPhase, { label: string; tone: string }>;

function V({ version }: { version: string }) {
  return <b className="mono">v{version}</b>;
}

export function CatalogPublication({
  skill,
  catalog,
  publicVersion,
  releaseBusy,
}: {
  skill: SkillVM;
  catalog: PublicReleaseCatalog;
  publicVersion: string | null;
  releaseBusy: boolean;
}) {
  const isOrgSkill = skill.scope === "org";
  const [status, setStatus] = useState<SkillPublicListingStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [frozenVersion, setFrozenVersion] = useState<string | null>(null);
  // The status does not name the submitted release; remember it when this dialog submitted it.
  const [submittedVersion, setSubmittedVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Promoting or withdrawing the public release changes what can be submitted; withdrawal also
  // unpublishes server-side, so the status is reread whenever the public version changes.
  useEffect(() => {
    if (!isOrgSkill) return;
    let active = true;
    setLoadError(false);
    fetchSkillPublicListing(skill.id).then(
      (value) => {
        if (active) setStatus(value);
      },
      () => {
        if (active) setLoadError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [isOrgSkill, skill.id, publicVersion, reload]);

  const listed = status?.listed_publicly === true;
  useEffect(() => {
    if (!listed) {
      setFrozenVersion(null);
      return;
    }
    let active = true;
    fetchCatalogPublishedVersion(catalog.orgSlug, skill.id).then(
      (value) => {
        if (active) setFrozenVersion(value);
      },
      () => {
        if (active) setFrozenVersion(null);
      },
    );
    return () => {
      active = false;
    };
  }, [listed, catalog.orgSlug, skill.id]);

  const run = async (action: () => Promise<SkillPublicListingStatus>, fallback: string, submitted: string | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
      setSubmittedVersion(submitted);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const header = (badge: CatalogPhase | null) => (
    <div className="catalog-pub__head">
      <h3 id="catalog-pub-title">Public catalog</h3>
      {badge && <span className={`badge ${PHASE_BADGE[badge].tone}`.trim()}>{PHASE_BADGE[badge].label}</span>}
    </div>
  );

  if (!isOrgSkill) {
    return (
      <section className="catalog-pub" aria-labelledby="catalog-pub-title">
        {header(null)}
        <p className="catalog-pub__text">
          Personal skills can’t be published to the catalog. Share this skill with the organization first; an Owner or Admin
          can then publish it.
        </p>
      </section>
    );
  }

  const phase = status ? catalogPhase(status) : null;
  const canManage = status?.can_manage_listing === true;
  const latest = status?.latest_submission ?? null;
  const openKind = latest?.status === "proposed" ? latest.kind : null;
  const hasRelease = publicVersion !== null;
  // A listed skill needs a new submission only for a different release than the one it serves.
  const newerRelease = phase !== "published" || (frozenVersion !== null && frozenVersion !== publicVersion);
  const canSubmit =
    status !== null &&
    hasRelease &&
    newerRelease &&
    (canManage ? openKind !== "submission" : openKind === null);
  const canUnpublish = canManage && (listed || openKind !== null);
  const unpublishLabel = listed ? "Unpublish" : openKind === "publish_request" ? "Decline request" : "Withdraw submission";
  const disabled = busy || releaseBusy;
  const accepted = isCatalogLicense(skill.license);

  return (
    <section className="catalog-pub" aria-labelledby="catalog-pub-title" aria-busy={status === null && !loadError}>
      {header(phase)}
      <p className="catalog-pub__text">
        Validated skills appear in the anonymous catalog, where anyone can read the public release’s SKILL.md and file list
        and search engines can index it. The public link works either way.
      </p>

      {status === null && !loadError && (
        <p className="catalog-pub__text catalog-pub__loading">
          <span className="cds-spinner" /> Loading catalog status…
        </p>
      )}
      {loadError && (
        <div className="catalog-pub__alert" role="alert">
          <span>Could not load the catalog status.</span>
          <button className="btn-ghost" type="button" onClick={() => setReload((count) => count + 1)}>
            <Icon name="refresh-cw" size={13} />
            Retry
          </button>
        </div>
      )}

      {phase && (
        <div className="public-release__note catalog-pub__state" data-phase={phase}>
          <Icon name={phase === "published" ? "lock" : phase === "rejected" ? "circle-x" : "info"} size={15} />
          <span>
            {phase === "published" && (
              <>
                {frozenVersion ? <V version={frozenVersion} /> : "The validated release"} is frozen in the catalog. Promoting a
                newer public version doesn’t change it until a new submission is validated. Stopping public access also
                unpublishes it.
                {openKind === "submission" && <> A newer submission is awaiting validation.</>}
                {openKind === "publish_request" && <> A Developer requested publication of a newer release.</>}
                {latest?.status === "rejected" && (
                  <> The latest submission was rejected{status?.rejection_reason ? `: ${status.rejection_reason}` : "."}</>
                )}
              </>
            )}
            {phase === "proposed" && (
              <>
                {submittedVersion ? <V version={submittedVersion} /> : "The public release at submission time"} is frozen for
                review. It appears in the catalog once validated.
              </>
            )}
            {phase === "requested" &&
              (canManage
                ? "A Developer requested publication. Publishing submits the current public release for validation."
                : "Publication requested. An Owner or Admin must publish it; the public release current at that time is frozen for review.")}
            {phase === "rejected" && (
              <>
                The submission was rejected
                {status?.rejection_reason ? (
                  <>
                    : <span className="catalog-pub__reason">{status.rejection_reason}</span>
                  </>
                ) : (
                  "."
                )}{" "}
                {canManage ? "Address the reason, then publish again." : "Address the reason, then request publication again."}
              </>
            )}
            {phase === "removed" &&
              (latest?.status === "validated"
                ? "Unpublished. The skill no longer appears in the catalog. Publishing again starts a new review."
                : "The last submission was withdrawn before validation. Publishing again starts a new review.")}
            {phase === "unpublished" &&
              (canManage
                ? "Publishing submits the current public release for validation. Only a validated release is listed."
                : "Only an Owner or Admin can publish. You can request publication of the current public release.")}
          </span>
        </div>
      )}

      {status && !hasRelease && (
        <p className="catalog-pub__text">Make a version public before publishing it to the catalog.</p>
      )}

      <p className="catalog-pub__license">
        <Icon name="shield-check" size={14} />
        <span>
          Only MIT or Apache-2.0 licensed skills are accepted.
          {!accepted && (
            <>
              {" "}
              {skill.license ? (
                <>
                  This skill declares <b className="mono">{skill.license}</b>.
                </>
              ) : (
                "This skill doesn’t declare a license in SKILL.md."
              )}
            </>
          )}
        </span>
      </p>

      {(canSubmit || canUnpublish) && (
        <div className="catalog-pub__actions">
          {canUnpublish && (
            <button
              className="btn-ghost public-release__remove"
              type="button"
              disabled={disabled}
              onClick={() => run(() => setSkillPublicListing(skill.id, false), "Could not unpublish the skill.", null)}
            >
              <Icon name="eye-off" size={14} />
              {unpublishLabel}
            </button>
          )}
          {canSubmit && (
            <button
              className="btn-sec"
              type="button"
              disabled={disabled}
              onClick={() =>
                canManage
                  ? run(() => setSkillPublicListing(skill.id, true), "Could not publish the skill.", publicVersion)
                  : run(() => requestSkillPublicListing(skill.id), "Could not request publication.", publicVersion)
              }
            >
              {busy ? <span className="cds-spinner" /> : <Icon name={canManage ? "send" : "megaphone"} size={14} />}
              {canManage ? "Publish to catalog" : "Request publication"}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="up-errblock" role="alert">
          <Icon name="alert-triangle" size={14} />
          {error}
        </div>
      )}
    </section>
  );
}
