import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const entrypoint = readFileSync(
  path.join(root, "deploy/margaya-entrypoint.sh"),
  "utf8",
);
const encoder = entrypoint.slice(
  entrypoint.indexOf("urlencode()"),
  entrypoint.indexOf('api_pid=""'),
);
for (const value of [
  "-password",
  "--require=bad",
  "-p",
  "space &/#%!'",
  "äöü",
]) {
  test(`database credentials preserve ${JSON.stringify(value)}`, () => {
    const result = spawnSync(
      "sh",
      ["-c", `${encoder}\nurlencode "$1"`, "test", value],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(decodeURIComponent(result.stdout), value);
  });
}

const authSecretHelpers = entrypoint.slice(
  entrypoint.indexOf("on_mounted_volume()"),
  entrypoint.indexOf("# Derive MARGAYA_API_URL"),
);
function loadAuthSecret(cwd, storageDir = "uploads", stubs = "") {
  return spawnSync(
    "sh",
    [
      "-c",
      `set -eu
${authSecretHelpers}
${stubs}
load_auth_secret
printf '%s' "$AUTH_SECRET" >&2`,
    ],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, MARGAYA_STORAGE_DIR: storageDir },
    },
  );
}
const lastLine = (text) => text.trim().split(/\r?\n/).at(-1);
const inTempDir = (run) => () => {
  const dir = mkdtempSync(path.join(tmpdir(), "margaya-auth-secret-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test(
  "a blank AUTH_SECRET is generated once and survives a restart",
  inTempDir((dir) => {
    const first = loadAuthSecret(dir);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /generated one and saved it/);
    const generated = readFileSync(
      path.join(dir, "uploads", ".auth-secret"),
      "utf8",
    ).trim();
    assert.match(generated, /^[0-9a-f]{64}$/);
    assert.equal(lastLine(first.stderr), generated);
    assert.doesNotMatch(first.stdout, new RegExp(generated));

    const second = loadAuthSecret(dir);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /using the generated secret saved/);
    assert.equal(lastLine(second.stderr), generated);
  }),
);

test(
  "a generated AUTH_SECRET outside a volume warns about saved secrets",
  inTempDir((dir) => {
    // A temp folder may itself be a mount, so the check is pinned here.
    const result = loadAuthSecret(
      dir,
      "uploads",
      "on_mounted_volume() { return 1; }",
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /isn't on a mounted volume/);
    assert.match(
      result.stderr,
      /Saved SMTP passwords, OAuth client secrets, AI keys/,
    );
  }),
);

test(
  "startup continues with a warning when AUTH_SECRET can't be saved",
  inTempDir((dir) => {
    // A file where the folder should be: mkdir fails, even for root.
    writeFileSync(path.join(dir, "blocked"), "");
    const result = loadAuthSecret(dir, "blocked/uploads");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /new secret is generated on every start/);
    assert.match(result.stderr, /Saved SMTP passwords/);
    assert.match(lastLine(result.stderr), /[0-9a-f]{64}$/);
  }),
);

test(
  "an unusable saved AUTH_SECRET is left alone and warned about",
  inTempDir((dir) => {
    mkdirSync(path.join(dir, "uploads"));
    const file = path.join(dir, "uploads", ".auth-secret");
    writeFileSync(file, "too-short");
    const result = loadAuthSecret(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /less than 32 characters/);
    assert.equal(readFileSync(file, "utf8"), "too-short");
  }),
);

for (const file of [
  "compose.yml",
  "compose.coolify.yml",
  "README.md",
  "apps/docs/core/installation/docker-compose.mdx",
  "apps/site/lib/guides/self-host-project-management-docker.ts",
]) {
  test(`${file} keeps uploads on a volume`, () => {
    const text = readFileSync(path.join(root, file), "utf8");
    assert.match(text, /uploads_data:\/app\/apps\/api\/data\/uploads/);
    assert.match(text, /MARGAYA_STORAGE_DIR/);
    assert.match(text, /^ +uploads_data:/m);
  });
}

test("minimal Compose configuration uses matching DB defaults without a published DB port", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "margaya-compose-test-"));
  try {
    writeFileSync(
      path.join(dir, "compose.yml"),
      readFileSync(path.join(root, "compose.yml")),
    );
    writeFileSync(
      path.join(dir, ".env"),
      "MARGAYA_CLIENT_URL=http://localhost:5173\nPOSTGRES_PASSWORD=test-password\nAUTH_SECRET=test-secret-at-least-thirty-two-characters\n",
    );
    const result = spawnSync(
      "docker",
      [
        "compose",
        "--env-file",
        path.join(dir, ".env"),
        "-f",
        path.join(dir, "compose.yml"),
        "config",
        "--format",
        "json",
      ],
      {
        encoding: "utf8",
        env: {
          PATH: "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
          HOME: process.env.HOME,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout);
    assert.equal(config.services.postgres.environment.POSTGRES_USER, "margaya");
    assert.equal(config.services.postgres.environment.POSTGRES_DB, "margaya");
    assert.equal(config.services.postgres.ports, undefined);
    assert.match(config.services.postgres.healthcheck.test[1], /POSTGRES_USER/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
