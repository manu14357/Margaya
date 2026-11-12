import { describe, expect, it } from "vitest";
import { Registry } from "../../../apps/api/src/observability/metrics";

describe("metrics registry", () => {
  it("renders counters, gauges and histograms in the Prometheus text format", async () => {
    const registry = new Registry();
    const requests = registry.counter("app_requests_total", "Requests.", [
      "route",
      "status",
    ]);
    const pool = registry.gauge("app_pool", "Pool.", ["state"]);
    const latency = registry.histogram(
      "app_latency_seconds",
      "Latency.",
      ["route"],
      [0.1, 1],
    );

    requests.inc({ route: "/api/task/:id", status: "200" });
    requests.inc({ route: "/api/task/:id", status: "200" }, 2);
    pool.set({ state: "idle" }, 3);
    latency.observe({ route: "/a" }, 0.05);
    latency.observe({ route: "/a" }, 0.5);
    latency.observe({ route: "/a" }, 5);

    const text = await registry.render();
    expect(text).toContain("# HELP app_requests_total Requests.");
    expect(text).toContain("# TYPE app_requests_total counter");
    expect(text).toContain(
      'app_requests_total{route="/api/task/:id",status="200"} 3',
    );
    expect(text).toContain('app_pool{state="idle"} 3');
    expect(text).toContain('app_latency_seconds_bucket{route="/a",le="0.1"} 1');
    expect(text).toContain('app_latency_seconds_bucket{route="/a",le="1"} 2');
    expect(text).toContain(
      'app_latency_seconds_bucket{route="/a",le="+Inf"} 3',
    );
    expect(text).toContain('app_latency_seconds_sum{route="/a"} 5.55');
    expect(text).toContain('app_latency_seconds_count{route="/a"} 3');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("escapes label values and skips empty families", async () => {
    const registry = new Registry();
    registry.counter("unused_total", "Never set.");
    const odd = registry.counter("odd_total", "Odd labels.", ["value"]);
    odd.inc({ value: 'a"b\\c\nd' });
    const text = await registry.render();
    expect(text).toContain('odd_total{value="a\\"b\\\\c\\nd"} 1');
    expect(text).not.toContain("unused_total");
  });

  it("ignores negative increments and caps the number of series", () => {
    const registry = new Registry();
    const capped = registry.counter("capped_total", "Capped.", ["id"]);
    capped.inc({ id: "x" }, -5);
    expect(capped.get({ id: "x" })).toBe(0);
    for (let i = 0; i < 2_100; i += 1) capped.inc({ id: String(i) });
    expect(capped.get({ id: "2050" })).toBe(0);
    expect(capped.get({ id: "10" })).toBe(1);
  });

  it("keeps rendering when a collector fails", async () => {
    const registry = new Registry();
    const gauge = registry.gauge("ok_gauge", "Fine.");
    registry.addCollector(() => {
      throw new Error("db down");
    });
    registry.addCollector(() => gauge.set({}, 1));
    const original = console.error;
    console.error = () => {};
    try {
      expect(await registry.render()).toContain("ok_gauge 1");
    } finally {
      console.error = original;
    }
  });

  it("refuses invalid metric names", () => {
    expect(() => new Registry().counter("bad-name", "x")).toThrow();
  });
});
