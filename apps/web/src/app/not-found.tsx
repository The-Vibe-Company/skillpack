import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/cds";

// Owning the 404 metadata replaces Next's built-in fallback, which rendered its own <title>
// next to the root layout title and left the page with two.
export const metadata: Metadata = {
  title: "Page not found",
  alternates: { canonical: null },
};

export default function NotFound() {
  return (
    <div className="app">
      <div className="main">
        <div className="og-set">
          <div className="og-set__top">
            <div className="og-set__crumb">
              <b>Skillpack</b>
            </div>
          </div>
          <div className="og-pane">
            <div className="og-pane__inner">
              <EmptyState
                title="Page not found"
                description="This page doesn't exist or is no longer available."
                action={
                  <Link href="/" className="cds-btn cds-btn--md cds-btn--secondary">
                    Back to Skillpack
                  </Link>
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
