import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { createApp } from "../../apps/api/src/index";
import type { instanceHealthSchema } from "../../apps/api/src/instance-admin/response";
import { refreshInstanceSettings } from "../../apps/api/src/instance-settings/snapshot";
import {
  jobFinished,
  recordFailure,
  resetJobTracking,
} from "../../apps/api/src/observability/jobs";
import { resetUpdateCheck } from "../../apps/api/src/observability/update-check";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import {
  adminRequest,
  resetInstanceState,
  signUpWithSession,
} from "./helpers/instance-admin";

type App = ReturnType<typeof createApp>["app"];

let app: App;
let admin: Awaited<ReturnType<typeof signUpWithSession>>;

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  resetJobTracking();
  resetUpdateCheck();
  app = createApp().app;
  admin = await signUpWithSession(app, "admin@example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("instance health", () => {
  it("reports the version, migrations, checks, jobs and failures", async () => {
    jobFinished("webhook-sweep", "ok", 12);
    jobFinished("notification-digest", "failed", 40, new Error("boom"));
    recordFailure("ai", "ask (anthropic)");

    const response = await adminRequest(app, "GET", "/health", admin.cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as z.infer<
      typeof instanceHealthSchema
    >;

    expect(body.version).toEqual(expect.any(String));
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(body.migrations).toMatchObject({ status: "ok", pending: 0 });
    expect(body.migrations.applied).toBeGreaterThan(0);

    const checks = Object.fromEntries(
      body.checks.map((check: { id: string }) => [check.id, check]),
    );
    expect(checks.database).toMatchObject({ status: "ok" });
    expect(checks.redis).toMatchObject({ status: "off", code: "disabled" });
    expect(checks.ai).toMatchObject({ status: "off", code: "disabled" });
    expect(Object.keys(checks).sort()).toEqual([
      "ai",
      "database",
      "email",
      "redis",
      "storage",
    ]);

    expect(body.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "webhook-sweep", lastOutcome: "ok" }),
        expect.objectContaining({
          name: "notification-digest",
          lastOutcome: "failed",
          failures: 1,
        }),
      ]),
    );
    expect(body.failures[0]).toMatchObject({ source: "ai", message: null });
    expect(body.failures[1]).toMatchObject({
      source: "job",
      name: "notification-digest",
      message: "Error: boom",
    });
    expect(body.queues).toEqual({
      emailBacklog: 0,
      webhookPending: 0,
      webhookFailed24h: 0,
    });
    expect(body.metrics).toEqual({ enabled: false, token: false, port: null });
  });

  it("never returns the metrics token", async () => {
    vi.stubEnv("MARGAYA_METRICS_ENABLED", "true");
    vi.stubEnv("MARGAYA_METRICS_TOKEN", "metrics-secret-token-123");
    const response = await adminRequest(app, "GET", "/health", admin.cookie);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain("metrics-secret-token-123");
    expect(JSON.parse(text).metrics).toMatchObject({
      enabled: true,
      token: true,
    });
  });

  it("is refused for someone who isn't an instance admin", async () => {
    const member = await signUpWithSession(app, "member@example.com");
    expect(
      (await adminRequest(app, "GET", "/health", member.cookie)).status,
    ).toBe(403);
    expect(
      (await adminRequest(app, "GET", "/update-status", member.cookie)).status,
    ).toBe(403);
  });
});

describe("update notice", () => {
  it("is off by default and fetches nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await adminRequest(
      app,
      "GET",
      "/update-status",
      admin.cookie,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      enabled: false,
      latestVersion: null,
      updateAvailable: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a newer release once switched on, sending nothing about the instance", async () => {
    vi.stubEnv("MARGAYA_UPDATE_CHECK", "true");
    await refreshInstanceSettings();
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: "v999.0.0",
            html_url:
              "https://github.com/manu14357/Margaya/releases/tag/v999.0.0",
            published_at: "2026-11-01T00:00:00Z",
            draft: false,
            prerelease: false,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const response = await adminRequest(
      app,
      "GET",
      "/update-status",
      admin.cookie,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      enabled: true,
      latestVersion: "999.0.0",
      updateAvailable: true,
      releaseUrl: "https://github.com/manu14357/Margaya/releases/tag/v999.0.0",
      error: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://api.github.com/repos/manu14357/Margaya/releases/latest",
    );
    expect(Object.keys(init.headers as Record<string, string>).sort()).toEqual([
      "accept",
      "user-agent",
    ]);
    vi.unstubAllEnvs();
    await refreshInstanceSettings();
  });
});
