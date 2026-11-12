import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

const { formatLogLine, logFormat } = await import(
  "../../../apps/api/src/observability/log-context"
);

describe("log lines", () => {
  it("names the request in text mode and leaves other lines alone", () => {
    expect(formatLogLine("error", ["failed:", 42], "req-1", "text")).toEqual([
      "[req req-1]",
      "failed:",
      42,
    ]);
    expect(formatLogLine("log", ["hello"], undefined, "text")).toEqual([
      "hello",
    ]);
  });

  it("writes one JSON object in json mode", () => {
    const [line] = formatLogLine(
      "log",
      ["sent %d emails", 3],
      "req-2",
      "json",
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(JSON.parse(String(line))).toEqual({
      time: "2026-01-01T00:00:00.000Z",
      level: "info",
      requestId: "req-2",
      msg: "sent 3 emails",
    });
  });

  it("reads MARGAYA_LOG_FORMAT", () => {
    expect(logFormat("JSON")).toBe("json");
    expect(logFormat(undefined)).toBe("text");
    expect(logFormat("pretty")).toBe("text");
  });
});
