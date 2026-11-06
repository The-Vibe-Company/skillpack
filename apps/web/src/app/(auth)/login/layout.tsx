import type { Metadata } from "next";

// /login is the sign-up conversion page, so it carries its own search copy instead of inheriting
// the home title and description from the root layout. The metadata lives in this layout rather
// than in page.tsx so the route's auth logic stays untouched.
const TITLE = "Sign Up for Skillpack: Share Agent Skills With Your Team";
const DESCRIPTION =
  "Create a free Skillpack workspace to publish SKILL.md agent skills, share them with your team and install them in Claude Code, Codex or OpenCode.";

// The site-wide share card, restated rather than imported from `@/lib/blog` so this auth route
// does not pull the blog's filesystem loader into its bundle.
const SHARE_IMAGE = {
  url: "/brand/og.png",
  width: 1200,
  height: 630,
  alt: "Skillpack — Share skills with your whole team.",
} as const;

export const metadata: Metadata = {
  // `absolute` opts out of the root layout's "%s · Skillpack" template; this title names the brand.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  // A page's `openGraph`/`twitter` replaces the root layout's, so the share card is restated here.
  // Canonical stays the root layout's path-relative "./", which resolves to /login, and the page
  // keeps no robots directive so it stays indexable.
  openGraph: {
    url: "/login",
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Skillpack",
    type: "website",
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: SHARE_IMAGE.url, alt: SHARE_IMAGE.alt }],
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
