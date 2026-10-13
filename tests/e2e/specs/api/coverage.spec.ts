import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../../fixtures";
import { E2E_ROOT } from "../../helpers/env";
import { liveOperationIds, loadOperations } from "../../helpers/openapi";

// Fails when an operation of the committed contract (apps/docs/openapi.json)
// is not referenced by any API or notification spec through covers("...").
// The scan is static, so covers() must receive string literals.

const SCANNED_DIRS = [
  path.join(E2E_ROOT, "specs", "api"),
  path.join(E2E_ROOT, "specs", "notifications"),
];

/**
 * Operations whose success path cannot run against the local e2e stack. Each
 * still has a spec that calls it and asserts the guard response the local
 * instance gives (so they also appear in covers()), but their happy path
 * needs an external service. Keep a reason for every entry.
 */
const ALLOWLIST: Record<string, string> = {
  // GitHub: linking needs a GitHub account connected through a real GitHub
  // App (OAuth against github.com). Locally these answer 403 "Connect your
  // GitHub account" or 404 "GitHub integration not found".
  listGitHubRepositories:
    "Needs a GitHub account connected through a real GitHub App installation.",
  verifyGitHubInstallation:
    "Needs a GitHub account connected through a real GitHub App installation.",
  createGitHubIntegration:
    "Needs a GitHub account connected through a real GitHub App installation.",
  updateGitHubIntegration:
    "Needs an existing GitHub integration, which needs a real GitHub App.",
  deleteGitHubIntegration:
    "Needs an existing GitHub integration, which needs a real GitHub App.",
  importGitHubIssues:
    "Needs an existing GitHub integration and GitHub's issues API.",
  // Uploads: the e2e API runs without S3-compatible storage (no S3_ENDPOINT /
  // S3_BUCKET), so presigned uploads answer 503 and no asset can exist.
  createTaskImageUpload:
    "Needs S3-compatible storage; the e2e API answers 503 without it.",
  finalizeTaskImageUpload: "Needs an object uploaded to S3-compatible storage.",
  createTaskAttachmentUpload:
    "Needs S3-compatible storage; the e2e API answers 503 without it.",
  finalizeTaskAttachment: "Needs an object uploaded to S3-compatible storage.",
  deleteTaskAttachment:
    "Needs an attachment, which needs S3-compatible storage.",
  getAsset: "Needs a stored asset, which needs S3-compatible storage.",
};

type Reference = { operationId: string; file: string };

function specFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return specFiles(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

function collectReferences(): Reference[] {
  const references: Reference[] = [];
  const self = path.resolve(fileURLToPath(import.meta.url));
  for (const file of SCANNED_DIRS.flatMap(specFiles)) {
    if (path.resolve(file) === self) continue;
    const source = readFileSync(file, "utf8");
    for (const call of source.matchAll(/\bcovers\(([^)]*)\)/g)) {
      for (const literal of (call[1] ?? "").matchAll(
        /["'`]([A-Za-z0-9_]+)["'`]/g,
      )) {
        if (literal[1]) {
          references.push({
            operationId: literal[1],
            file: path.relative(E2E_ROOT, file),
          });
        }
      }
    }
  }
  return references;
}

test.describe("OpenAPI coverage", () => {
  const operations = loadOperations();
  const references = collectReferences();
  const covered = new Set(references.map((reference) => reference.operationId));

  test("every operation in apps/docs/openapi.json is exercised by a spec", () => {
    const missing = operations
      .filter(
        (operation) =>
          !covered.has(operation.operationId) &&
          !(operation.operationId in ALLOWLIST),
      )
      .map(
        (operation) =>
          `${operation.operationId} (${operation.method.toUpperCase()} ${operation.path})`,
      );

    const coveredCount = operations.filter((operation) =>
      covered.has(operation.operationId),
    ).length;
    test.info().annotations.push({
      type: "coverage",
      description: `${coveredCount}/${operations.length} operations covered; allowlist ${Object.keys(ALLOWLIST).length}`,
    });

    expect(
      missing,
      `Operations with no covers("...") reference in specs/api or specs/notifications`,
    ).toEqual([]);
  });

  test("covers() only names operations that exist", async () => {
    const known = new Set(operations.map((operation) => operation.operationId));
    // Routes deployed on the running API before the contract is regenerated
    // are fine too.
    const live = await liveOperationIds();
    const unknown = references
      .filter(
        (reference) =>
          !known.has(reference.operationId) && !live.has(reference.operationId),
      )
      .map((reference) => `${reference.operationId} in ${reference.file}`);
    expect(unknown).toEqual([]);
  });

  test("every allowlist entry is a real operation with a reason", () => {
    const known = new Set(operations.map((operation) => operation.operationId));
    for (const [operationId, reason] of Object.entries(ALLOWLIST)) {
      expect(
        known.has(operationId),
        `${operationId} is not in the contract`,
      ).toBe(true);
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});
