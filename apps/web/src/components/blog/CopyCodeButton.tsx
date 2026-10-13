"use client";

import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

const RESET_MS = 2000;

/** Copies the code of the enclosing `[data-code-block]`, read from the page so it is not sent twice. */
export function CopyCodeButton() {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  async function copy(button: HTMLButtonElement) {
    const code = button.closest("[data-code-block]")?.querySelector("pre")?.textContent ?? "";
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(code.replace(/\n$/, ""));
    } catch {
      // Clipboard access needs a secure context and permission; say so instead of failing silently.
      next = "failed";
    }
    setState(next);
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setState("idle"), RESET_MS);
  }

  return (
    <>
      <button
        type="button"
        className="v10-code__copy"
        aria-label="Copy code"
        data-state={state}
        onClick={(event) => void copy(event.currentTarget)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          {state === "copied" ? (
            <path d="M20 6 9 17l-5-5" />
          ) : (
            <>
              <rect x="9" y="9" width="12" height="12" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </>
          )}
        </svg>
        <span aria-hidden="true">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span>
      </button>
      <span className="sr-only" role="status">
        {state === "copied" ? "Code copied to clipboard" : state === "failed" ? "Could not copy code" : ""}
      </span>
    </>
  );
}
