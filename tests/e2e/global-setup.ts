import { execFileSync } from "node:child_process";
import path from "node:path";
import { chromium } from "@playwright/test";
import { authFile } from "./helpers/auth";
import { ensureDatabase } from "./helpers/database";
import {
  AUTH_DIR,
  E2E_API_URL,
  E2E_DATABASE_URL,
  E2E_WEB_MODE,
  E2E_WEB_URL,
  REPO_ROOT,
} from "./helpers/env";
import { waitForUrl } from "./helpers/http";
import { MailpitClient } from "./helpers/mailpit";
import { runSeed } from "./seed/seed";

async function ensureMailpit(): Promise<void> {
  const mailpit = new MailpitClient();
  if (await mailpit.isReachable()) return;

  console.log("[e2e] MailPit is not running; starting compose.e2e.yml");
  try {
    execFileSync(
      "docker",
      ["compose", "-f", path.join(REPO_ROOT, "compose.e2e.yml"), "up", "-d"],
      { cwd: REPO_ROOT, stdio: "inherit" },
    );
  } catch {
    // Reported below with the manual command.
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await mailpit.isReachable()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "MailPit is not reachable on http://127.0.0.1:8025. Start it with: docker compose -f compose.e2e.yml up -d",
  );
}

/**
 * Load the app once before any spec runs, retrying until the sign-in form and
 * a signed-in board both render. A production build (the default) renders on
 * the first try. A cold Vite dev server (E2E_WEB_SERVER=dev) compiles the
 * module graph on first request and may re-optimize dependencies it only
 * discovers then; without HMR (see webServerEnv) such a page stays blank.
 */
async function warmWebApp(boardPath: string): Promise<void> {
  const browser = await chromium.launch({ channel: "msedge" });
  try {
    const targets = [
      { path: "/auth/sign-in", storageState: undefined, ready: "Sign in" },
      {
        path: boardPath,
        storageState: authFile("owner"),
        ready: "Account menu",
      },
    ];
    for (const target of targets) {
      const context = await browser.newContext({
        baseURL: E2E_WEB_URL,
        storageState: target.storageState,
      });
      const page = await context.newPage();
      const deadline = Date.now() + 180_000;
      for (;;) {
        try {
          await page.goto(target.path, { timeout: 90_000 });
          await page
            .getByRole("button", { name: target.ready, exact: true })
            .first()
            .waitFor({ timeout: 30_000 });
          break;
        } catch (error) {
          if (Date.now() > deadline) throw error;
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(): Promise<void> {
  await ensureMailpit();
  // Normally already done by the API webServer command; kept so the suite also
  // works against servers started by hand (reuseExistingServer).
  await ensureDatabase(E2E_DATABASE_URL);
  await waitForUrl(`${E2E_API_URL}/api/health`, { timeoutMs: 180_000 });
  await waitForUrl(E2E_WEB_URL, { timeoutMs: 180_000 });

  const started = Date.now();
  const manifest = await runSeed({
    apiURL: E2E_API_URL,
    clientURL: E2E_WEB_URL,
    authDir: AUTH_DIR,
    log: (message) => console.log(`[seed] ${message}`),
  });
  console.log(
    `[e2e] Seeded "${manifest.workspace.name}" in ${Date.now() - started}ms`,
  );

  console.log(
    E2E_WEB_MODE === "dev"
      ? "[e2e] Web app: Vite dev server (E2E_WEB_SERVER=dev)"
      : "[e2e] Web app: production build served by vite preview",
  );
  const warmed = Date.now();
  await warmWebApp(
    `/dashboard/workspace/${manifest.workspace.id}/project/${manifest.projects.web.id}/board`,
  );
  console.log(`[e2e] Web app warmed in ${Date.now() - warmed}ms`);
}
