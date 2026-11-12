import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

const { httpRequests } = await import(
  "../../../apps/api/src/observability/instruments"
);
const { currentRequestId, requestObservability, resolveRequestId } =
  await import("../../../apps/api/src/observability/request-context");

afterEach(() => vi.unstubAllEnvs());

function appWith(lines: string[]) {
  const app = new Hono();
  app.use(
    "*",
    requestObservability((line) => lines.push(line)),
  );
  app.get("/api/task/:id", (c) =>
    c.json({ requestId: currentRequestId() ?? null }),
  );
  app.get("/boom", () => {
    throw new Error("boom");
  });
  app.onError((_error, c) =>
    c.json({ requestId: currentRequestId() ?? null }, 500),
  );
  return app;
}

describe("request IDs", () => {
  it("keeps a safe incoming ID and replaces anything else", () => {
    expect(resolveRequestId("abc-123_def.456")).toBe("abc-123_def.456");
    expect(resolveRequestId("short")).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId("has space inside")).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId("x".repeat(200))).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns the ID and makes it available to handlers and error handlers", async () => {
    const app = appWith([]);
    const ok = await app.request("/api/task/t1", {
      headers: { "X-Request-Id": "trace-0001-abcd" },
    });
    expect(ok.headers.get("X-Request-Id")).toBe("trace-0001-abcd");
    expect(await ok.json()).toEqual({ requestId: "trace-0001-abcd" });

    const failed = await app.request("/boom");
    const id = failed.headers.get("X-Request-Id");
    expect(failed.status).toBe(500);
    expect(id).toBeTruthy();
    expect(await failed.json()).toEqual({ requestId: id });
  });

  it("writes no access log and records no metrics by default", async () => {
    const lines: string[] = [];
    const before = httpRequests.get({
      method: "GET",
      route: "/api/task/:id",
      status: "200",
    });
    await appWith(lines).request("/api/task/t1");
    expect(lines).toEqual([]);
    expect(
      httpRequests.get({
        method: "GET",
        route: "/api/task/:id",
        status: "200",
      }),
    ).toBe(before);
  });

  it("logs and counts by route template, never the path or query", async () => {
    vi.stubEnv("MARGAYA_ACCESS_LOG", "true");
    vi.stubEnv("MARGAYA_METRICS_ENABLED", "true");
    const lines: string[] = [];
    const before = httpRequests.get({
      method: "GET",
      route: "/api/task/:id",
      status: "200",
    });
    await appWith(lines).request("/api/task/secret-task-id?token=abc", {
      headers: { "X-Request-Id": "trace-0002-abcd" },
    });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? "{}");
    expect(entry).toMatchObject({
      type: "access",
      requestId: "trace-0002-abcd",
      method: "GET",
      route: "/api/task/:id",
      status: 200,
    });
    expect(lines[0]).not.toContain("secret-task-id");
    expect(lines[0]).not.toContain("token");
    expect(
      httpRequests.get({
        method: "GET",
        route: "/api/task/:id",
        status: "200",
      }),
    ).toBe(before + 1);
  });
});
