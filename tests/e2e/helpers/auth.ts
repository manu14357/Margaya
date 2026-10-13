import { readFileSync } from "node:fs";
import path from "node:path";
import type { Role } from "../seed/data";
import type { SeedManifest } from "../seed/seed";
import { AUTH_DIR, SEED_MANIFEST_PATH } from "./env";

/** Storage state written by global setup for a seeded role. */
export function authFile(role: Role): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

let cachedManifest: SeedManifest | undefined;

/** Ids and names of everything global setup seeded (tests/e2e/.auth/seed.json). */
export function loadSeedManifest(): SeedManifest {
  if (!cachedManifest) {
    cachedManifest = JSON.parse(
      readFileSync(SEED_MANIFEST_PATH, "utf8"),
    ) as SeedManifest;
  }
  return cachedManifest;
}
