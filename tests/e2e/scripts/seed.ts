// Seed the demo accounts and data through a running API.
//
//   pnpm db:seed                          dev API on :1337 (margaya_dev)
//   pnpm --filter @margaya/e2e seed:e2e   e2e API on :3337 (margaya_e2e)
//
// The target API must already be running; this script only talks HTTP.
import path from "node:path";
import {
  AUTH_DIR,
  DEV_API_URL,
  DEV_WEB_URL,
  E2E_API_URL,
  E2E_WEB_URL,
} from "../helpers/env";
import { waitForUrl } from "../helpers/http";
import { ROLES, SEED_USERS } from "../seed/data";
import { runSeed } from "../seed/seed";

const targetIndex = process.argv.indexOf("--target");
const targetName =
  targetIndex >= 0
    ? process.argv[targetIndex + 1]
    : (process.env.SEED_TARGET ?? "dev");

if (targetName !== "dev" && targetName !== "e2e") {
  console.error(`Unknown --target "${targetName}". Use dev or e2e.`);
  process.exit(1);
}

const target =
  targetName === "e2e"
    ? { apiURL: E2E_API_URL, clientURL: E2E_WEB_URL, authDir: AUTH_DIR }
    : {
        apiURL: DEV_API_URL,
        clientURL: DEV_WEB_URL,
        authDir: path.join(AUTH_DIR, "dev"),
      };

try {
  await waitForUrl(`${target.apiURL}/api/health`, { timeoutMs: 5_000 });
} catch {
  console.error(
    `The API is not reachable at ${target.apiURL}. Start it first (${
      targetName === "dev" ? "pnpm dev" : "pnpm e2e"
    }) and run the seed again.`,
  );
  process.exit(1);
}

const manifest = await runSeed({
  ...target,
  log: (message) => console.log(`[seed] ${message}`),
});

console.log(
  `\nSeeded "${manifest.workspace.name}" at ${target.apiURL} (sign in at ${target.clientURL}):`,
);
for (const role of ROLES) {
  const user = SEED_USERS[role];
  console.log(`  ${role.padEnd(7)} ${user.email.padEnd(22)} ${user.password}`);
}
for (const project of Object.values(manifest.projects)) {
  console.log(
    `  project ${project.slug}: ${project.name} (${Object.keys(project.tasks).length} seeded tasks)`,
  );
}
