import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({
  default: {},
  getDatabasePool: () => ({
    totalCount: 4,
    idleCount: 3,
    waitingCount: 0,
    options: { max: 10 },
  }),
}));
vi.mock("../../../apps/api/src/observability/queues", () => ({
  readQueueBacklogs: async () => ({
    emailBacklog: 2,
    webhookPending: 1,
    webhookFailed24h: 0,
  }),
}));
vi.mock("../../../apps/api/src/ws", () => ({
  localConnectionCounts: () => ({ project: 5, user: 7 }),
}));
vi.mock("../../../apps/api/src/page/collab/rooms", () => ({
  openPageRoomCount: () => 1,
}));

const {
  answerMetricsRequest,
  bearerMatches,
  metricsConfig,
  metricsConfigWarnings,
} = await import("../../../apps/api/src/observability/metrics-endpoint");

const TOKEN = "a-long-metrics-token-1234";

describe("metrics configuration", () => {
  it("is off by default", () => {
    expect(metricsConfig({})).toEqual({
      enabled: false,
      token: null,
      port: null,
      host: "0.0.0.0",
    });
  });

  it("reads the token, port and host", () => {
    expect(
      metricsConfig({
        MARGAYA_METRICS_ENABLED: "TRUE",
        MARGAYA_METRICS_TOKEN: ` ${TOKEN} `,
        MARGAYA_METRICS_PORT: "9464",
        MARGAYA_METRICS_HOST: "127.0.0.1",
      }),
    ).toEqual({ enabled: true, token: TOKEN, port: 9464, host: "127.0.0.1" });
    expect(metricsConfig({ MARGAYA_METRICS_PORT: "70000" }).port).toBeNull();
  });

  it("warns when enabled with no way to reach it, or a short token", () => {
    const env = { MARGAYA_METRICS_ENABLED: "true" };
    expect(metricsConfigWarnings(metricsConfig(env), env)).toHaveLength(1);
    const short = { ...env, MARGAYA_METRICS_TOKEN: "short" };
    expect(metricsConfigWarnings(metricsConfig(short), short)).toHaveLength(2);
  });
});

describe("metrics answers", () => {
  it("answers 404 when off, or on the API route without a token", async () => {
    const off = metricsConfig({});
    expect(
      (await answerMetricsRequest(null, { viaPort: false, config: off }))
        .status,
    ).toBe(404);
    const portOnly = metricsConfig({
      MARGAYA_METRICS_ENABLED: "true",
      MARGAYA_METRICS_PORT: "9464",
    });
    expect(
      (await answerMetricsRequest(null, { viaPort: false, config: portOnly }))
        .status,
    ).toBe(404);
  });

  it("needs the token on the API route", async () => {
    const config = metricsConfig({
      MARGAYA_METRICS_ENABLED: "true",
      MARGAYA_METRICS_TOKEN: TOKEN,
    });
    expect(
      (await answerMetricsRequest(null, { viaPort: false, config })).status,
    ).toBe(401);
    expect(
      (await answerMetricsRequest("Bearer wrong", { viaPort: false, config }))
        .status,
    ).toBe(401);
    const answer = await answerMetricsRequest(`Bearer ${TOKEN}`, {
      viaPort: false,
      config,
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toContain(
      'margaya_db_pool_connections{state="idle"} 3',
    );
    expect(answer.body).toContain(
      'margaya_websocket_connections{kind="user"} 7',
    );
    expect(answer.body).toContain('margaya_queue_backlog{queue="email"} 2');
    expect(answer.body).toContain("margaya_page_collab_rooms 1");
    expect(answer.body).toContain("process_resident_memory_bytes");
    expect(answer.body).toContain(
      "# TYPE process_cpu_user_seconds_total counter",
    );
    expect(answer.body).toMatch(/margaya_build_info\{version="[^"]+",node="v/);
  });

  it("serves the separate port without a token unless one is set", async () => {
    const config = metricsConfig({
      MARGAYA_METRICS_ENABLED: "true",
      MARGAYA_METRICS_PORT: "9464",
    });
    expect(
      (await answerMetricsRequest(null, { viaPort: true, config })).status,
    ).toBe(200);
  });

  it("compares bearer tokens exactly", () => {
    expect(bearerMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(bearerMatches(`bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(bearerMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(bearerMatches(TOKEN, TOKEN)).toBe(false);
    expect(bearerMatches(undefined, TOKEN)).toBe(false);
  });
});
