import { execFileSync } from "node:child_process";
import path from "node:path";
import { ensureDatabase } from "./helpers/database";
import {
  AUTH_DIR,
  E2E_API_URL,
  E2E_DATABASE_URL,
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
}
