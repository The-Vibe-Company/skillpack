"use client";

import { useEffect } from "react";

export function PublicWebMcp() {
  useEffect(() => {
    const context = document.modelContext ?? navigator.modelContext;
    if (!context) return;
    // Only browsers exposing WebMCP load the tool definitions (and zod with them).
    let unregister: (() => void) | undefined;
    let unmounted = false;
    void import("@/lib/webMcp").then(({ registerPublicWebMcpTools }) => {
      if (!unmounted) unregister = registerPublicWebMcpTools(context);
    });
    return () => {
      unmounted = true;
      unregister?.();
    };
  }, []);
  return null;
}
