import { expect, test } from "../../fixtures";
import {
  createApiKey,
  deleteApiKey,
  expectJson,
  expectStatus,
  headerContext,
  signUpUser,
  type TestUser,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";

// Running the instance: the health page, the update notice and the
// Prometheus endpoint. On this instance metrics are off (no
// MARGAYA_METRICS_ENABLED or token) and the update check is off by default,
// so nothing here reaches outside the machine.

type Check = {
  id: "database" | "redis" | "storage" | "email" | "ai";
  status: "ok" | "warning" | "error" | "off";
  code: string | null;
  latencyMs: number | null;
  count: number | null;
};
type Health = {
  version: string;
  nodeVersion: string;
  startedAt: string;
  uptimeSeconds: number;
  migrations: {
    status: "ok" | "pending" | "unknown";
    applied: number;
    available: number;
    pending: number;
    latest: string | null;
  };
  checks: Check[];
  jobs: { name: string; runs: number; failures: number }[];
  failures: { source: string; name: string }[];
  queues: Record<string, number> | null;
  connections: { project: number; user: number; pageRooms: number };
  metrics: { enabled: boolean; token: boolean; port: number | null };
};
type UpdateStatus = {
  enabled: boolean;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  publishedAt: string | null;
  checkedAt: string | null;
  error: string | null;
};
type Settings = {
  settings: { key: string; value: unknown; source: string }[];
};

let outsider: TestUser;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  outsider = await signUpUser("Instance ops outsider");
});

test.afterAll(async () => {
  await outsider?.ctx.dispose();
});

test(
  "metrics are off: every caller gets the same 404, never cached",
  covers("getMetrics"),
  async ({ apiAs }) => {
    const anonymous = await apiAs("anonymous");
    const owner = await apiAs("owner");
    const attempts = [
      await anonymous.get("/api/metrics"),
      await anonymous.get("/api/metrics", {
        headers: { Authorization: "Bearer e2e-not-the-metrics-token-0001" },
      }),
      await owner.get("/api/metrics"),
    ];
    for (const response of attempts) {
      // Off answers 404, not 401: a wrong token can't tell it is on.
      await expectStatus(response, 404);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await response.text()).not.toContain("http_requests");
    }
  },
);

test(
  "the instance admin reads the health report; nobody else does",
  covers("getInstanceHealth"),
  async ({ apiAs }) => {
    const owner = await apiAs("owner");
    const response = await owner.get("/api/instance-admin/health");
    const health = await expectJson<Health>(response);
    expect(health.version).toMatch(/\S/);
    expect(health.nodeVersion).toMatch(/^v\d+\./);
    expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(new Date(health.startedAt).getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
    expect(["ok", "pending", "unknown"]).toContain(health.migrations.status);
    if (health.migrations.status === "ok") {
      expect(health.migrations.pending).toBe(0);
      expect(health.migrations.applied).toBeGreaterThan(0);
    }

    expect(health.checks.map((check) => check.id).sort()).toEqual([
      "ai",
      "database",
      "email",
      "redis",
      "storage",
    ]);
    const byId = Object.fromEntries(
      health.checks.map((check) => [check.id, check]),
    );
    expect(byId.database).toMatchObject({ status: "ok", code: null });
    expect(byId.database?.latencyMs).toBeGreaterThanOrEqual(0);
    // SMTP points at the local mail catcher, so the sign-in check runs.
    expect(byId.email?.status).not.toBe("off");
    for (const check of health.checks) {
      expect(["ok", "warning", "error", "off"]).toContain(check.status);
    }
    expect(Array.isArray(health.jobs)).toBe(true);
    expect(Array.isArray(health.failures)).toBe(true);
    expect(health.connections.project).toBeGreaterThanOrEqual(0);
    // Metrics are off on this instance, and the token is never returned.
    expect(health.metrics).toEqual({
      enabled: false,
      token: false,
      port: null,
    });

    // States and codes only: never hosts, ports, URLs or credentials.
    const raw = JSON.stringify(health);
    for (const leak of [
      "127.0.0.1",
      "localhost",
      "postgres://",
      "postgresql",
    ]) {
      expect(raw).not.toContain(leak);
    }
    expect(response.headers()["cache-control"]).toBe("no-store");

    // A workspace admin is not an instance admin.
    await expectStatus(
      await (await apiAs("admin")).get("/api/instance-admin/health"),
      403,
    );
    await expectStatus(
      await outsider.ctx.get("/api/instance-admin/health"),
      403,
    );
    await expectStatus(
      await (await apiAs("anonymous")).get("/api/instance-admin/health"),
      401,
    );
    const key = await createApiKey(owner);
    const viaKey = await headerContext({ "x-api-key": key.key });
    try {
      await expectStatus(await viaKey.get("/api/instance-admin/health"), 403);
    } finally {
      await viaKey.dispose();
      await deleteApiKey(owner, key.id);
    }
  },
);

test(
  "the update notice is off by default and fetches nothing",
  covers("getInstanceUpdateStatus"),
  async ({ apiAs }) => {
    const owner = await apiAs("owner");
    const settings = await expectJson<Settings>(
      await owner.get("/api/instance-admin/settings"),
    );
    // With the check on the route would read the public release feed;
    // this suite keeps it off.
    expect(
      settings.settings.find((setting) => setting.key === "general.updateCheck")
        ?.value,
    ).toBe(false);

    const health = await expectJson<Health>(
      await owner.get("/api/instance-admin/health"),
    );
    const status = await expectJson<UpdateStatus>(
      await owner.get("/api/instance-admin/update-status"),
    );
    expect(status).toEqual({
      enabled: false,
      currentVersion: health.version,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      publishedAt: null,
      checkedAt: null,
      error: null,
    });

    await expectStatus(
      await (await apiAs("admin")).get("/api/instance-admin/update-status"),
      403,
    );
    await expectStatus(
      await outsider.ctx.get("/api/instance-admin/update-status"),
      403,
    );
    await expectStatus(
      await (await apiAs("anonymous")).get("/api/instance-admin/update-status"),
      401,
    );
  },
);
