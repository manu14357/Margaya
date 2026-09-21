import { describe, expect, it } from "vitest";
import {
  formatRequestBody,
  isInFlight,
  redeliverBlock,
  responseLabel,
  statusQueryOf,
} from "./delivery";

describe("responseLabel", () => {
  const base = { responseStatus: null, error: null, status: "failed" } as const;

  it("shows the HTTP status", () => {
    expect(responseLabel({ ...base, responseStatus: 200 })).toEqual({
      type: "http",
      status: 200,
    });
    expect(responseLabel({ ...base, responseStatus: 500 })).toEqual({
      type: "http",
      status: 500,
    });
  });

  it.each([
    ["Timed out after 10 seconds", "timeout"],
    ["Connection failed", "network"],
    ["Destination not allowed", "destination"],
    ["Signing secret unavailable", "secret"],
  ])("maps %s", (error, kind) => {
    expect(responseLabel({ ...base, error })).toEqual({ type: "label", kind });
  });

  it("prefers 'redirect not followed' over the 3xx status", () => {
    expect(
      responseLabel({
        ...base,
        responseStatus: 302,
        error: "Redirects are not followed",
      }),
    ).toEqual({ type: "label", kind: "redirect" });
  });

  it("labels a cancelled delivery without a response", () => {
    expect(
      responseLabel({
        ...base,
        status: "cancelled",
        error: "Webhook paused",
      }),
    ).toEqual({ type: "label", kind: "cancelled" });
  });

  it("falls back to the raw error, or nothing before any attempt", () => {
    expect(responseLabel({ ...base, error: "Something new" })).toEqual({
      type: "text",
      text: "Something new",
    });
    expect(responseLabel({ ...base, status: "pending" })).toBeNull();
  });
});

describe("isInFlight", () => {
  it("is true for pending and sending only", () => {
    expect(isInFlight("pending")).toBe(true);
    expect(isInFlight("sending")).toBe(true);
    expect(isInFlight("succeeded")).toBe(false);
    expect(isInFlight("failed")).toBe(false);
    expect(isInFlight("cancelled")).toBe(false);
  });
});

describe("statusQueryOf", () => {
  it("maps toolbar filters to the status query", () => {
    expect(statusQueryOf("all")).toBeUndefined();
    expect(statusQueryOf("inProgress")).toBe("pending,sending");
    expect(statusQueryOf("failed")).toBe("failed");
  });
});

describe("redeliverBlock", () => {
  it("blocks tests, deliveries in progress and inactive webhooks", () => {
    expect(redeliverBlock({ trigger: "ping", status: "succeeded" }, true)).toBe(
      "ping",
    );
    expect(redeliverBlock({ trigger: "event", status: "sending" }, true)).toBe(
      "inProgress",
    );
    expect(redeliverBlock({ trigger: "event", status: "failed" }, false)).toBe(
      "inactive",
    );
    expect(
      redeliverBlock({ trigger: "redelivery", status: "failed" }, true),
    ).toBeNull();
  });
});

describe("formatRequestBody", () => {
  it("pretty-prints objects and JSON strings, and keeps other text", () => {
    expect(formatRequestBody({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(formatRequestBody('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatRequestBody("<b>not json</b>")).toBe("<b>not json</b>");
    expect(formatRequestBody(null)).toBe("");
  });
});
