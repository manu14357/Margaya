import { describe, expect, it } from "vitest";
import {
  INVALID_WEBHOOK_URL,
  normalizeWebhookUrl,
  pointsAtInstance,
  WEBHOOK_URL_CREDENTIALS,
} from "../../../apps/api/src/webhook/url";

describe("normalizeWebhookUrl", () => {
  it("lower-cases scheme and host and drops the fragment and default port", () => {
    expect(
      normalizeWebhookUrl("  HTTPS://Example.COM:443/Hook?Token=AbC#frag "),
    ).toBe("https://example.com/Hook?Token=AbC");
    expect(normalizeWebhookUrl("http://example.com:80/x")).toBe(
      "http://example.com/x",
    );
    expect(normalizeWebhookUrl("https://example.com:8443/x")).toBe(
      "https://example.com:8443/x",
    );
  });

  it("keeps path and query verbatim", () => {
    expect(normalizeWebhookUrl("https://hooks.example.com/A/B?x=1&Y=2")).toBe(
      "https://hooks.example.com/A/B?x=1&Y=2",
    );
  });

  it("rejects credentials", () => {
    expect(() => normalizeWebhookUrl("https://user:pw@example.com/")).toThrow(
      WEBHOOK_URL_CREDENTIALS,
    );
    expect(() => normalizeWebhookUrl("https://user@example.com/")).toThrow(
      WEBHOOK_URL_CREDENTIALS,
    );
  });

  it("rejects other schemes and garbage", () => {
    for (const bad of [
      "ftp://example.com",
      "javascript:alert(1)",
      "nope",
      "",
    ]) {
      expect(() => normalizeWebhookUrl(bad), bad).toThrow(INVALID_WEBHOOK_URL);
    }
  });
});

describe("pointsAtInstance", () => {
  const env = {
    MARGAYA_API_URL: "https://margaya.example.com/api",
    MARGAYA_CLIENT_URL: "https://app.example.com",
  } as NodeJS.ProcessEnv;

  it("matches the API and web hosts, whatever the path", () => {
    expect(pointsAtInstance("https://margaya.example.com/api/hook", env)).toBe(
      true,
    );
    expect(pointsAtInstance("https://app.example.com/anything", env)).toBe(
      true,
    );
    expect(pointsAtInstance("https://margaya.example.com./x", env)).toBe(true);
  });

  it("lets other hosts and ports through", () => {
    expect(pointsAtInstance("https://hooks.example.com/x", env)).toBe(false);
    expect(pointsAtInstance("https://app.example.com:8443/x", env)).toBe(false);
  });
});
