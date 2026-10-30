"use client";

import { useEffect } from "react";
import { registerPublicWebMcpTools } from "@/lib/webMcp";

export function PublicWebMcp() {
  useEffect(() => registerPublicWebMcpTools(document.modelContext ?? navigator.modelContext), []);
  return null;
}
