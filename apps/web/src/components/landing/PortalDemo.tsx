"use client";

/* Lazy client island for the hero library demo. The demo is not needed for
   first paint, so its code loads after hydration; until then a static frame
   of the same size holds its place so the hero does not shift. */

import dynamic from "next/dynamic";

function PortalPlaceholder() {
  return (
    <div className="v10-libframe v6-pframe lp-portal-placeholder" aria-hidden="true">
      <div className="lp-frame__bar">
        <span></span>
        <span></span>
        <span></span>
        <code>skillpack.app/skills</code>
      </div>
    </div>
  );
}

const PortalCapture = dynamic(() => import("./PortalCapture").then((m) => m.PortalCapture), {
  ssr: false,
  loading: PortalPlaceholder,
});

export function PortalDemo() {
  return <PortalCapture />;
}
