import { describe, expect, it } from "vitest";
import {
  isValidWebhookUrl,
  lastDelivery,
  webhookChanges,
  webhookDisplayName,
  webhookState,
} from "./webhook";

describe("isValidWebhookUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isValidWebhookUrl("https://example.com/hooks")).toBe(true);
    expect(isValidWebhookUrl("  http://example.com:8080/x  ")).toBe(true);
  });

  it("rejects other schemes, garbage and empty input", () => {
    expect(isValidWebhookUrl("ftp://example.com")).toBe(false);
    expect(isValidWebhookUrl("example.com/hooks")).toBe(false);
    expect(isValidWebhookUrl("")).toBe(false);
    expect(isValidWebhookUrl(`https://example.com/${"a".repeat(2048)}`)).toBe(
      false,
    );
  });
});

describe("webhookDisplayName", () => {
  it("uses the name, else the URL's host", () => {
    expect(
      webhookDisplayName({ name: "Deploys", url: "https://a.example/x" }),
    ).toBe("Deploys");
    expect(webhookDisplayName({ name: null, url: "https://a.example/x" })).toBe(
      "a.example",
    );
    expect(webhookDisplayName({ name: "  ", url: "not a url" })).toBe(
      "not a url",
    );
  });
});

describe("webhookState", () => {
  it("tells active, paused and disabled apart", () => {
    expect(webhookState({ isActive: true, disabledReason: null })).toBe(
      "active",
    );
    expect(webhookState({ isActive: false, disabledReason: "manual" })).toBe(
      "paused",
    );
    expect(webhookState({ isActive: false, disabledReason: "failures" })).toBe(
      "disabled",
    );
  });
});

describe("lastDelivery", () => {
  const health = {
    lastSuccessAt: null,
    lastFailureAt: null,
    failureStreak: 0,
    failingSince: null,
  };

  it("is null without any finished delivery", () => {
    expect(lastDelivery(health)).toBeNull();
  });

  it("picks the more recent outcome", () => {
    expect(
      lastDelivery({
        ...health,
        lastSuccessAt: "2026-10-01T10:00:00.000Z",
        lastFailureAt: "2026-10-02T10:00:00.000Z",
      }),
    ).toEqual({ result: "failed", at: "2026-10-02T10:00:00.000Z" });
    expect(
      lastDelivery({ ...health, lastSuccessAt: "2026-10-01T10:00:00.000Z" }),
    ).toEqual({ result: "succeeded", at: "2026-10-01T10:00:00.000Z" });
  });
});

describe("webhookChanges", () => {
  const original = {
    name: "Deploys",
    url: "https://example.com/a",
    events: ["comment.created", "task.*"],
    isActive: true,
  };

  it("sends nothing when nothing changed", () => {
    expect(
      webhookChanges(original, {
        name: " Deploys ",
        url: "https://example.com/a",
        events: ["task.*", "comment.created"],
        isActive: true,
      }),
    ).toEqual({});
  });

  it("sends only the changed fields, clearing an emptied name", () => {
    expect(
      webhookChanges(original, {
        name: "",
        url: "https://example.com/b ",
        events: ["*"],
        isActive: false,
      }),
    ).toEqual({
      name: null,
      url: "https://example.com/b",
      events: ["*"],
      isActive: false,
    });
  });
});
