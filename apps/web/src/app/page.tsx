import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing/LandingPage";
import { AuthUnavailable } from "@/components/org/WorkspaceLoadError";
import { preloadDisplayFont } from "@/lib/displayFont";
import { loadServerAuth } from "@/lib/serverAuth";
// The home page's own layout; public pages that share landing.css never download it.
import "@/styles/home.css";

export default async function Home() {
  const authState = await loadServerAuth();
  if (authState.status === "authenticated") redirect("/skills");
  if (authState.status === "unavailable") return <AuthUnavailable />;
  preloadDisplayFont();
  return <LandingPage />;
}
