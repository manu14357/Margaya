import path from "node:path";
import { defineConfig, devices, type Project } from "@playwright/test";
import { authFile } from "./helpers/auth";
import {
  apiServerEnv,
  E2E_API_URL,
  E2E_WEB_PORT,
  E2E_WEB_URL,
  REPO_ROOT,
  webServerEnv,
} from "./helpers/env";

const isCI = Boolean(process.env.CI);
// Opt-in extras: a bundled-Chromium project (run `npx playwright install
// chromium` first) and the public docs site (apps/site on :3001).
const withChromium = process.env.E2E_CHROMIUM === "1";
const withDocsSite = process.env.E2E_DOCS_SITE === "1";
const DOCS_SITE_URL = "http://localhost:3001";

const appProjects: Project[] = [
  {
    name: "msedge",
    testIgnore: /docs-site[\\/]/,
    use: { ...devices["Desktop Edge"], channel: "msedge" },
  },
];
if (withChromium) {
  appProjects.push({
    name: "chromium",
    testIgnore: /docs-site[\\/]/,
    use: { ...devices["Desktop Chrome"] },
  });
}
if (withDocsSite) {
  appProjects.push({
    name: "docs-site",
    testMatch: /docs-site[\\/].*\.spec\.ts/,
    use: {
      ...devices["Desktop Edge"],
      channel: "msedge",
      baseURL: DOCS_SITE_URL,
      storageState: { cookies: [], origins: [] },
    },
  });
}

export default defineConfig({
  testDir: "./specs",
  outputDir: "./test-results",
  globalSetup: "./global-setup.ts",
  // Specs share one database: files run in parallel, tests in a file in order.
  fullyParallel: false,
  workers: process.env.E2E_WORKERS
    ? Number(process.env.E2E_WORKERS)
    : isCI
      ? 1
      : 3,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: E2E_WEB_URL,
    // Signed in as the workspace owner unless a spec says otherwise.
    storageState: authFile("owner"),
    locale: "en-US",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    navigationTimeout: 30_000,
  },
  projects: appProjects,
  webServer: [
    {
      name: "api",
      // The API migrates on boot, so margaya_e2e must exist before it starts.
      command:
        "pnpm exec tsx ../../tests/e2e/scripts/ensure-database.ts && pnpm exec tsx src/index.ts",
      cwd: path.join(REPO_ROOT, "apps", "api"),
      url: `${E2E_API_URL}/api/health`,
      env: apiServerEnv,
      reuseExistingServer: !isCI,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      name: "web",
      command: `pnpm exec vite --port ${E2E_WEB_PORT} --strictPort`,
      cwd: path.join(REPO_ROOT, "apps", "web"),
      url: E2E_WEB_URL,
      env: webServerEnv,
      reuseExistingServer: !isCI,
      timeout: 180_000,
    },
    ...(withDocsSite
      ? [
          {
            name: "docs-site",
            command: "pnpm exec next dev -p 3001",
            cwd: path.join(REPO_ROOT, "apps", "site"),
            url: DOCS_SITE_URL,
            reuseExistingServer: !isCI,
            timeout: 300_000,
          },
        ]
      : []),
  ],
});
