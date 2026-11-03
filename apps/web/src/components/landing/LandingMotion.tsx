"use client";

/* Lazy client island for the landing's motion: the scroll reveal and the phone-menu dismissal load in
   their own chunk after hydration, so they never weigh on first paint. Nothing renders before or
   after it loads; every word is already in the server HTML. */

import dynamic from "next/dynamic";

const LandingReveal = dynamic(() => import("./LandingReveal").then((m) => m.LandingReveal), { ssr: false });

export function LandingMotion() {
  return <LandingReveal />;
}
