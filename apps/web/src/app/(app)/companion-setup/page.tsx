import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The Skillpack skill install is no longer a hard gate (the dismissible install dialog now lives inside
 * the Skillpack skills view). This route is kept only so older links still land somewhere sensible.
 */
export default function SkillpackSetupPage() {
  redirect("/skills?view=local");
}
