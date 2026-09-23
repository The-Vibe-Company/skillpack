"use client";

import { useRef, type ReactNode } from "react";
import { Icon } from "@/components/Icon";

export type OnboardingStep = "workspace" | "team" | "agent";

const STEPS: Array<{ id: OnboardingStep; label: string }> = [
  { id: "workspace", label: "Workspace" },
  { id: "team", label: "Team" },
  { id: "agent", label: "Agent" },
];

/** Fixed three-step progress. On the join path Team is marked done: joining needs no invitations. */
function ProgressSteps({ step, teamSkipped }: { step: OnboardingStep; teamSkipped: boolean }) {
  const current = STEPS.findIndex((s) => s.id === step);
  return (
    <>
      <ol className="ob-progress" aria-label="Setup progress">
        {STEPS.map((s, index) => {
          const state = index < current ? "done" : index === current ? "current" : "todo";
          const skipped = s.id === "team" && teamSkipped && index < current;
          return (
            <li
              key={s.id}
              className={`ob-progress__item ob-progress__item--${state}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className="ob-progress__num" aria-hidden="true">
                {state === "done" ? <Icon name="check" size={12} /> : index + 1}
              </span>
              <span className="ob-progress__label">{s.label}</span>
              {state === "done" ? (
                <span className="sr-only">{skipped ? " (not needed when joining)" : " (done)"}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <span className="ob-progress-compact" aria-hidden="true">
        {current + 1} of {STEPS.length} · {STEPS[current]?.label}
      </span>
    </>
  );
}

/** The onboarding page frame: brand, progress, signed-in email, log out, and one centered column. */
export function OnboardingShell({
  step,
  teamSkipped,
  email,
  children,
}: {
  step: OnboardingStep;
  teamSkipped: boolean;
  email: string;
  children: ReactNode;
}) {
  const logoutForm = useRef<HTMLFormElement>(null);
  return (
    <div className="ob">
      {/* Full-page POST logout, mirroring the login form's redirect flow. */}
      <form ref={logoutForm} method="post" action="/v1/auth/logout" className="ob-logout-form" />
      <header className="ob-top">
        <div className="ob-brand">
          <span className="ob-brand__mark" aria-hidden="true" />
          <span className="ob-brand__wm">Skillpack</span>
        </div>
        <ProgressSteps step={step} teamSkipped={teamSkipped} />
        <div className="ob-top__account">
          <span className="ob-emailchip" title={email}>{email}</span>
          <button
            type="button"
            className="ob-logout"
            onClick={() => logoutForm.current?.submit()}
            aria-label="Log out"
            title="Log out"
          >
            <Icon name="log-out" size={16} />
          </button>
        </div>
      </header>
      <main className="ob-main">
        <div className="ob-col" key={step}>
          {children}
        </div>
      </main>
    </div>
  );
}
