#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const COMMITTED = resolve("apps/docs/openapi.json");
const FIX = process.argv.includes("--fix");
// Invoke pnpm through Node so Windows paths and arguments never pass through cmd.exe.
// biome-ignore lint/suspicious/noUndeclaredEnvVars: this entrypoint runs outside Turbo's task cache.
const packageManager = process.env.npm_execpath;
if (!packageManager) {
  throw new Error(
    "Run this check with pnpm openapi:check or pnpm openapi:check:fix",
  );
}
const RUN = {
  stdio: ["ignore", "ignore", "inherit"],
  env: {
    ...process.env,
    AUTH_SECRET: "openapi-export-only-secret-not-for-serving",
  },
};

// The npm-installed pnpm is a JS file run by Node; @pnpm/exe is a native binary.
function pnpm(args) {
  if (packageManager.endsWith(".exe")) {
    execFileSync(packageManager, args, RUN);
  } else {
    execFileSync(process.execPath, [packageManager, ...args], RUN);
  }
}

function generate(into) {
  pnpm(["turbo", "build", "--filter=@margaya/api^..."]);
  pnpm([
    "--filter",
    "@margaya/api",
    "exec",
    "tsx",
    "scripts/export-openapi.ts",
    into,
  ]);
}

function run() {
  const workdir = mkdtempSync(join(tmpdir(), "margaya-openapi-"));
  const generated = join(workdir, "openapi.json");

  try {
    generate(generated);

    const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    const committed = existsSync(COMMITTED) ? read(COMMITTED) : null;
    if (committed === read(generated)) {
      console.log("apps/docs/openapi.json is up to date");
      return 0;
    }

    if (FIX) {
      copyFileSync(generated, COMMITTED);
      console.log("apps/docs/openapi.json regenerated");
      return 0;
    }

    console.error(
      `apps/docs/openapi.json is ${committed === null ? "missing" : "out of date"}.\n` +
        "The docs site serves this file, so it has to be regenerated and committed\n" +
        "whenever a route, request schema, or response schema changes.\n\n" +
        "  pnpm openapi:check:fix\n",
    );
    return 1;
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

process.exitCode = run();
