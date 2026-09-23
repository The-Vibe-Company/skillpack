"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Step title. With `focusOnMount`, focus lands here so screen readers announce the new step. */
export function StepHeading({
  title,
  children,
  focusOnMount = false,
}: {
  title: string;
  children?: ReactNode;
  focusOnMount?: boolean;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  return (
    <div className="ob-head">
      <h1 className="ob-h1" ref={ref} tabIndex={-1}>
        {title}
      </h1>
      {children ? <p className="ob-sub">{children}</p> : null}
    </div>
  );
}

export function StepError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="ob-error" role="alert">
      {message}
    </p>
  );
}
