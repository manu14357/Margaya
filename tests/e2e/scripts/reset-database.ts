// Drop and recreate margaya_e2e (never any other database). The next
// `pnpm e2e` migrates and seeds it from scratch.
import { resetE2eDatabase } from "../helpers/database";
import { E2E_DATABASE_URL } from "../helpers/env";

await resetE2eDatabase(E2E_DATABASE_URL);
console.log(
  "[e2e] Recreated margaya_e2e. Stop any running e2e API; the next pnpm e2e migrates and seeds it.",
);
