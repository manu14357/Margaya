import { afterEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ loads: 0, initSentry: vi.fn() }));

vi.mock("./sentry", () => {
  sentry.loads += 1;
  return { initSentry: sentry.initSentry };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  sentry.loads = 0;
  sentry.initSentry.mockReset();
});

async function runInstrument(dsn: string) {
  vi.stubEnv("VITE_SENTRY_DSN", dsn);
  await import("./instrument");
  await vi.dynamicImportSettled();
}

describe("instrument", () => {
  it("leaves the Sentry SDK unloaded without a DSN", async () => {
    await runInstrument("");
    expect(sentry.loads).toBe(0);
    expect(sentry.initSentry).not.toHaveBeenCalled();
  });

  it("leaves it unloaded when env.sh kept the placeholder", async () => {
    await runInstrument("MARGAYA_SENTRY_DSN");
    expect(sentry.loads).toBe(0);
  });

  it("loads and starts it with a configured DSN", async () => {
    await runInstrument("https://public@errors.example.invalid/1");
    expect(sentry.loads).toBe(1);
    expect(sentry.initSentry).toHaveBeenCalledWith(
      "https://public@errors.example.invalid/1",
    );
  });
});
