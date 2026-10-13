"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Badge, Button, EmptyState } from "@/components/cds";
import { Icon } from "@/components/Icon";
import { Dialog } from "@/components/org/primitives";
import { ApiFetchError } from "@/lib/apiClient";
import {
  CATALOG_MODERATION_PAGE_SIZE,
  CATALOG_MODERATION_REASON_MAX,
  CATALOG_MODERATION_STATUSES,
  catalogModerationHref,
  submitCatalogModerationDecision,
  type CatalogModerationDecision,
  type CatalogModerationStatus,
  type CatalogModerationSubmission,
  type CatalogModerationView,
  type CatalogSkillReport,
  type CatalogSkillReportsState,
} from "@/lib/catalogModeration";
import { formatHumanDateUTC } from "@/lib/format";

const STATUS_LABEL = {
  proposed: "Proposed",
  validated: "Validated",
  rejected: "Rejected",
  removed: "Removed",
} satisfies Record<CatalogModerationStatus, string>;
const STATUS_TONE = {
  proposed: "neutral",
  validated: "ok",
  rejected: "danger",
  removed: "danger",
} satisfies Record<CatalogModerationStatus, "ok" | "danger" | "neutral">;
const EMPTY_COPY = {
  proposed: { title: "No submissions waiting", description: "New catalog submissions appear here once an organization admin proposes a public release." },
  validated: { title: "Nothing validated yet", description: "Validated submissions are the versions served by the public catalog." },
  rejected: { title: "No rejected submissions", description: "Rejected proposals and the reason given to the organization appear here." },
  removed: { title: "No removed listings", description: "Skills removed from the catalog appear here with the removal reason." },
} satisfies Record<CatalogModerationStatus, { title: string; description: string }>;

type PendingAction = "validate" | "reject" | "remove" | "ban";
type DialogTarget = { action: PendingAction; submission: CatalogModerationSubmission };

const DIALOG_COPY = {
  validate: {
    title: "Validate submission",
    desc: "The frozen version becomes discoverable and installable from the public catalog.",
    confirm: "Validate",
    done: "Submission validated and listed.",
    danger: false,
  },
  reject: {
    title: "Reject submission",
    desc: "The organization sees this reason and can propose a new release. A version that is already listed stays listed.",
    confirm: "Reject",
    done: "Submission rejected.",
    danger: true,
  },
  remove: {
    title: "Remove from catalog",
    desc: "Unlists the whole skill and closes its pending submissions. Its public release and share links keep working. Relisting needs a fresh submission.",
    confirm: "Remove listing",
    done: "Skill removed from the catalog.",
    danger: true,
  },
  ban: {
    title: "Ban organization from publishing",
    desc: "Unlists every catalog skill from this organization and closes its pending submissions. New submissions fail until an operator lifts the ban. Public releases and share links keep working.",
    confirm: "Ban organization",
    done: "Organization banned from publishing.",
    danger: true,
  },
} satisfies Record<PendingAction, { title: string; desc: string; confirm: string; done: string; danger: boolean }>;

export function CatalogModerationApp({
  view,
  submissions,
  hasNextPage,
  reports,
}: {
  view: CatalogModerationView;
  submissions: CatalogModerationSubmission[];
  hasNextPage: boolean;
  reports: CatalogSkillReportsState;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<DialogTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const completed = (action: PendingAction) => {
    setTarget(null);
    setToast(DIALOG_COPY[action].done);
    router.refresh();
  };

  return (
    <div className="app">
      <div className="main">
        <div className="og-set">
          <div className="og-set__top">
            <Link className="og-set__back mod-back" href="/skills">
              <Icon name="arrow-left" size={13} />
              Skills
            </Link>
            <div className="og-set__crumb">
              <span>Platform</span>
              <span aria-hidden="true">/</span>
              <b>Catalog moderation</b>
            </div>
          </div>
          <div className="og-pane mod-pane">
            <div className="mod-inner">
              <header className="og-pane__head">
                <h1 className="og-pane__title">Catalog moderation</h1>
                <p className="og-pane__desc">
                  Review public catalog submissions across organizations. Validation needs passing automatic checks, and every decision is audited.
                </p>
              </header>
              <nav className="og-seg mod-tabs" aria-label="Moderation views">
                {CATALOG_MODERATION_STATUSES.map((status) => {
                  const active = view.view === "queue" && view.status === status;
                  return (
                    <Link
                      key={status}
                      className={"og-seg__btn" + (active ? " is-on" : "")}
                      aria-current={active ? "page" : undefined}
                      href={catalogModerationHref({ view: "queue", status, offset: 0 })}
                    >
                      {STATUS_LABEL[status]}
                    </Link>
                  );
                })}
                <Link
                  className={"og-seg__btn" + (view.view === "reports" ? " is-on" : "")}
                  aria-current={view.view === "reports" ? "page" : undefined}
                  href={catalogModerationHref({ view: "reports" })}
                >
                  <Icon name="megaphone" size={13} />
                  Reports
                </Link>
              </nav>
              {view.view === "reports" ? (
                <ReportsPanel reports={reports} />
              ) : (
                <>
                  {submissions.length === 0 ? (
                    <EmptyState {...EMPTY_COPY[view.status]} />
                  ) : (
                    <ul className="mod-list" aria-label={`${STATUS_LABEL[view.status]} submissions`}>
                      {submissions.map((submission) => (
                        <li key={submission.id}>
                          <SubmissionCard
                            submission={submission}
                            onAction={(action) => setTarget({ action, submission })}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                  <Pager view={view} hasNextPage={hasNextPage} />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {target && (
        <DecisionDialog
          target={target}
          onClose={() => setTarget(null)}
          onDone={() => completed(target.action)}
        />
      )}
      {toast && (
        <div className="og-toast og-toast--ok" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}

function Pager({ view, hasNextPage }: { view: Extract<CatalogModerationView, { view: "queue" }>; hasNextPage: boolean }) {
  if (view.offset === 0 && !hasNextPage) return null;
  const previous = Math.max(0, view.offset - CATALOG_MODERATION_PAGE_SIZE);
  return (
    <nav className="mod-pager" aria-label="Pagination">
      {view.offset > 0 ? (
        <Link className="btn-sec" href={catalogModerationHref({ ...view, offset: previous })}>
          <Icon name="arrow-left" size={13} />
          Previous
        </Link>
      ) : <span />}
      <span className="mod-pager__range">Page {view.offset / CATALOG_MODERATION_PAGE_SIZE + 1}</span>
      {hasNextPage ? (
        <Link className="btn-sec" href={catalogModerationHref({ ...view, offset: view.offset + CATALOG_MODERATION_PAGE_SIZE })}>
          Next
          <Icon name="arrow-right" size={13} />
        </Link>
      ) : <span />}
    </nav>
  );
}

function CheckSummary({ submission }: { submission: CatalogModerationSubmission }) {
  if (submission.check_status === "passed") {
    return (
      <div className="mod-check">
        <Badge tone="ok" dot>Checks passed</Badge>
        {submission.check_reason && <span className="mod-check__reason">{submission.check_reason}</span>}
      </div>
    );
  }
  if (submission.check_status === "failed") {
    return (
      <div className="mod-check">
        <Badge tone="danger" dot>Checks failed</Badge>
        <span className="mod-check__reason">{submission.check_reason ?? "No reason was recorded."}</span>
      </div>
    );
  }
  return (
    <div className="mod-check">
      <Badge tone="warn" dot>Checks pending</Badge>
      <span className="mod-check__reason">No passing report for this exact version yet.</span>
    </div>
  );
}

function SubmissionCard({
  submission,
  onAction,
}: {
  submission: CatalogModerationSubmission;
  onAction: (action: PendingAction) => void;
}) {
  const validateHintId = useId();
  const canValidate = submission.check_status === "passed";
  return (
    <article className="mod-card" aria-label={`Submission ${submission.id}`}>
      <div className="mod-card__head">
        <Badge tone={STATUS_TONE[submission.status]}>{STATUS_LABEL[submission.status]}</Badge>
        <span className="mod-card__date">
          Submitted {formatHumanDateUTC(submission.created_at)}
          {submission.decided_at && ` · Decided ${formatHumanDateUTC(submission.decided_at)}`}
        </span>
      </div>
      {/* Decided rows only repeat a check summary that a report actually recorded. */}
      {(submission.status === "proposed" || submission.check_status !== "pending") && <CheckSummary submission={submission} />}
      <dl className="mod-card__meta">
        <div><dt>Organization</dt><dd>{submission.org_id}</dd></div>
        <div><dt>Skill</dt><dd>{submission.skill_id}</dd></div>
        <div><dt>Version</dt><dd>{submission.skill_version_id}</dd></div>
        <div><dt>Checksum</dt><dd>{submission.package_checksum}</dd></div>
        <div><dt>Submission</dt><dd>{submission.id}</dd></div>
      </dl>
      {submission.rejection_reason && (
        <p className="mod-card__reason">
          <b>Decision reason</b>
          {submission.rejection_reason}
        </p>
      )}
      <div className="mod-card__actions">
        {submission.status === "proposed" && (
          <>
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={!canValidate}
              aria-describedby={canValidate ? undefined : validateHintId}
              iconLeft={<Icon name="check" size={13} />}
              onClick={() => onAction("validate")}
            >
              Validate
            </Button>
            <Button type="button" size="sm" iconLeft={<Icon name="x" size={13} />} onClick={() => onAction("reject")}>
              Reject
            </Button>
          </>
        )}
        {submission.status === "validated" && (
          <Button type="button" size="sm" variant="danger" iconLeft={<Icon name="eye-off" size={13} />} onClick={() => onAction("remove")}>
            Remove listing
          </Button>
        )}
        <span className="mod-card__spacer" />
        <Button type="button" size="sm" variant="ghost" className="mod-card__ban" iconLeft={<Icon name="ban" size={13} />} onClick={() => onAction("ban")}>
          Ban organization
        </Button>
      </div>
      {submission.status === "proposed" && !canValidate && (
        <p id={validateHintId} className="mod-card__hint">
          Validation unlocks when automatic checks pass for this exact version.
        </p>
      )}
    </article>
  );
}

function decisionFor(target: DialogTarget, reason: string): CatalogModerationDecision {
  if (target.action === "validate") return { action: "validate", submission: target.submission };
  if (target.action === "ban") return { action: "ban", orgId: target.submission.org_id, reason };
  return { action: target.action, submission: target.submission, reason };
}

function DecisionDialog({
  target,
  onClose,
  onDone,
}: {
  target: DialogTarget;
  onClose: () => void;
  onDone: () => void;
}) {
  const copy = DIALOG_COPY[target.action];
  const needsReason = target.action !== "validate";
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const countId = useId();
  const trimmed = reason.trim();
  const valid = !needsReason || (trimmed.length > 0 && trimmed.length <= CATALOG_MODERATION_REASON_MAX);

  const submit = async () => {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      await submitCatalogModerationDecision(decisionFor(target, trimmed));
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiFetchError ? cause.message : "Couldn't reach Skillpack. Try again.");
      setPending(false);
    }
  };

  return (
    <Dialog
      icon={target.action === "validate" ? "shield-check" : target.action === "ban" ? "ban" : "shield"}
      iconDanger={copy.danger}
      title={copy.title}
      desc={copy.desc}
      onClose={onClose}
      closeDisabled={pending}
      foot={
        <>
          <span className="og-spacer" />
          <button type="button" className="btn-sec" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className={copy.danger ? "btn-danger" : "btn-primary"}
            disabled={!valid || pending}
            onClick={() => void submit()}
          >
            {pending ? "Saving…" : copy.confirm}
          </button>
        </>
      }
    >
      {error && (
        <div className="og-errbar" role="alert">
          <Icon name="alert-triangle" size={14} />
          {error}
        </div>
      )}
      <dl className="mod-dialog__target">
        <div><dt>Organization</dt><dd>{target.submission.org_id}</dd></div>
        {target.action !== "ban" && <div><dt>Submission</dt><dd>{target.submission.id}</dd></div>}
      </dl>
      {needsReason && (
        <div className="sx-field">
          <label className="sx-field__label" htmlFor={reasonId}>Reason</label>
          <textarea
            id={reasonId}
            className="sx-textarea mod-dialog__reason"
            value={reason}
            rows={4}
            maxLength={CATALOG_MODERATION_REASON_MAX}
            aria-describedby={countId}
            required
            disabled={pending}
            placeholder={target.action === "reject" ? "Unsupported license" : "Explain the decision for the audit log"}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="sx-field__meta">
            <span className="sx-field__hint">Recorded in the audit log.</span>
            <span id={countId} className="sx-field__count">
              {CATALOG_MODERATION_REASON_MAX - reason.length} left
            </span>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function ReportsPanel({ reports }: { reports: CatalogSkillReportsState }) {
  if (reports.status === "unavailable") {
    return (
      <EmptyState
        title="Skill reports aren't connected yet"
        description="Reports filed from public catalog pages will appear here once catalog reporting ships. Until then, review listed skills from the Validated tab."
      />
    );
  }
  if (reports.reports.length === 0) {
    return <EmptyState title="No open reports" description="Nobody has reported a catalog skill." />;
  }
  return (
    <ul className="mod-list" aria-label="Skill reports">
      {reports.reports.map((report) => (
        <li key={report.id}>
          <ReportCard report={report} />
        </li>
      ))}
    </ul>
  );
}

function ReportCard({ report }: { report: CatalogSkillReport }) {
  return (
    <article className="mod-card" aria-label={`Report ${report.id}`}>
      <div className="mod-card__head">
        <Badge tone="warn">{report.reason}</Badge>
        <span className="mod-card__date">Reported {formatHumanDateUTC(report.created_at)}</span>
      </div>
      {report.details && <p className="mod-card__reason">{report.details}</p>}
      <dl className="mod-card__meta">
        <div><dt>Organization</dt><dd>{report.org_id}</dd></div>
        <div><dt>Skill</dt><dd>{report.skill_id}</dd></div>
        {report.submission_id && <div><dt>Submission</dt><dd>{report.submission_id}</dd></div>}
      </dl>
    </article>
  );
}
