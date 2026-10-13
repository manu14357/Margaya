// Run before the e2e API boots (see playwright.config.ts): the API migrates at
// startup, so its database has to exist first.
import { ensureDatabase } from "../helpers/database";
import { E2E_DATABASE_URL } from "../helpers/env";

const created = await ensureDatabase(E2E_DATABASE_URL);
console.log(
  created
    ? "[e2e] Created database margaya_e2e"
    : "[e2e] Database margaya_e2e exists",
);
