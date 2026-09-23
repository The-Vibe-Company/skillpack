import { expect, test, type Page } from "@playwright/test";

/**
 * Product promise:
 * A new member signs up, creates a workspace, invites a teammate, and connects a coding agent in
 * three steps. Invitations are emailed only when the workspace is created, and the agent step
 * survives a reload and turns "Connected" by itself when the agent reports the install.
 *
 * Regression caught:
 * The previous flow claimed "invites sent" before creating anything, dropped the typed name, and
 * never reached an agent; a reload after creation bounced the member away from setup.
 *
 * Why this test needs a browser:
 * Only a real signup (email code via Mailpit), cookie-bound org selection, navigation, reload, and
 * live polling together prove the member can finish setup.
 *
 * Failure proof:
 * Creating on Continue, sending no invitation email, redirecting the agent step on reload, or
 * polling a signal the install never sets fails the URL, mailbox, and status assertions below.
 */

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function mailpitBase(): string {
  const port = process.env.MAILPIT_WEB_PORT;
  if (!port) {
    throw new Error("MAILPIT_WEB_PORT is required: the onboarding flow reads the signup code from Mailpit.");
  }
  return `http://127.0.0.1:${port}`;
}

interface MailpitSummary {
  ID: string;
  Subject: string;
}

async function waitForMessages(to: string, subject: string): Promise<MailpitSummary[]> {
  const query = encodeURIComponent(`to:${to} subject:"${subject}"`);
  let found: MailpitSummary[] = [];
  await expect
    .poll(async () => {
      const res = await fetch(`${mailpitBase()}/api/v1/search?query=${query}`);
      // SAFETY: Mailpit's v1 search endpoint returns `{ messages: [{ ID, Subject, ... }] }`.
      found = ((await res.json()) as { messages: MailpitSummary[] }).messages;
      return found.length;
    }, { timeout: 15_000 })
    .toBeGreaterThan(0);
  return found;
}

async function signupCode(email: string): Promise<string> {
  const [message] = await waitForMessages(email, "verification code");
  const res = await fetch(`${mailpitBase()}/api/v1/message/${message!.ID}`);
  // SAFETY: Mailpit's v1 message endpoint returns the plain-text body as `Text`.
  const text = ((await res.json()) as { Text: string }).Text;
  const code = text.match(/\b\d{6}\b/)?.[0];
  if (!code) throw new Error(`no 6-digit code in the verification email for ${email}`);
  return code;
}

function trackFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) failures.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return failures;
}

test("a new member creates a workspace, invites a teammate, and connects an agent", async ({ page }) => {
  const failures = trackFailures(page);
  // External image providers are not part of the promise: keep favicon and avatar loads deterministic.
  for (const pattern of ["https://icon.horse/**", "https://www.gravatar.com/**"]) {
    await page.route(pattern, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }));
  }

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const domain = `onb-${suffix}.test`;
  const email = `alex.rivera@${domain}`;
  const teammate = `sam@${domain}`;

  await page.goto("/login?mode=signup");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const code = await signupCode(email);
  await page.getByRole("textbox", { name: "Digit 1" }).click();
  await page.keyboard.type(code);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.waitForLoadState("networkidle");

  // Step 1: the name suggestion comes from the address, the workspace name from the domain.
  await expect(page.getByRole("heading", { name: "Create your workspace" })).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveValue("Alex Rivera");
  await expect(page.getByLabel("Workspace name")).toHaveValue(`Onb-${suffix}`);
  await page.getByLabel("Workspace name").fill("Rivera Labs");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Step 2: nothing exists until the member confirms.
  await expect(page.getByRole("heading", { name: "Invite your team" })).toBeVisible();
  await page.getByLabel("Email addresses").fill(teammate);
  await page.getByLabel("Email addresses").press("Enter");
  await page.getByRole("button", { name: "Create and invite 1", exact: true }).click();

  // Step 3: the URL makes the step reload-safe, and the invitation really went out.
  await expect(page).toHaveURL(/\/onboarding\?step=agent$/);
  await expect(page.getByText("Invited 1 person.")).toBeVisible();
  await waitForMessages(teammate, "Invitation to Rivera Labs");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connect your coding agent" })).toBeVisible();
  await expect(page.getByText("Waiting for your agent")).toBeVisible();

  // The agent's install report is the connection signal; simulate it from the member's session.
  const status = await page.evaluate(async () => {
    // SAFETY: `GET /v1/local-skills` returns LocalSkillRow[]; only `key` and `availableVersion` are read.
    const rows = (await (await fetch("/v1/local-skills")).json()) as Array<{ key: string; availableVersion: string }>;
    const skill = rows.find((row) => row.key === "skillpack") ?? rows.find((row) => row.key === "companion");
    const res = await fetch(`/v1/local-skills/${skill!.key}/installed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: skill!.availableVersion, agent: "Claude Code" }),
    });
    return res.status;
  });
  expect(status).toBe(200);
  await expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Open Skillpack", exact: true }).click();
  await expect(page).toHaveURL(/\/skills(?:\?|$)/);
  const installStep = page.locator(".gs-step", { hasText: "Install Skillpack" });
  await expect(installStep.getByText("Done", { exact: true })).toBeVisible();

  expect(failures, "onboarding must not hide browser or server failures").toEqual([]);
});
