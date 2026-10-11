import { describe, expect, it } from "vitest";
import {
  diffFields,
  isSensitiveKey,
  REDACTED,
  redact,
  redactMetadata,
  redactUrl,
} from "../../../apps/api/src/audit-log/redact";
import { auditLogRetentionDays } from "../../../apps/api/src/audit-log/settings";
import { permissionChanges } from "../../../apps/api/src/audit-log/snapshots";

describe("audit log redaction", () => {
  it.each([
    "secret",
    "webhookSecret",
    "signing_secret",
    "accessToken",
    "refresh_token",
    "botToken",
    "password",
    "smtpPassword",
    "SMTP_PASS",
    "pass",
    "apiKey",
    "api_key",
    "key",
    "privateKey",
    "authorization",
    "cookie",
    "webhookUrl",
    "secretCiphertext",
    "clientSecret",
    "credentials",
    "session",
  ])("treats %s as a secret", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    "name",
    "role",
    "apiKeyId",
    "sessionId",
    "tokenId",
    "events",
    "isActive",
    "channelName",
    "footprint",
    "timezone",
  ])("keeps %s", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  it("replaces secrets at any depth and keeps the rest", () => {
    const out = redact({
      name: "Deploy hook",
      secret: "whsec_abc",
      config: {
        webhookUrl: "https://hooks.example.com/T0/B0/xyz",
        channel: "#ops",
      },
      list: [{ token: "t1", label: "a" }],
      empty: null,
    });
    expect(out).toEqual({
      name: "Deploy hook",
      secret: REDACTED,
      config: { webhookUrl: REDACTED, channel: "#ops" },
      list: [{ token: REDACTED, label: "a" }],
      empty: null,
    });
  });

  it("redacts values that look like credentials under any key", () => {
    expect(redact({ note: "Bearer abc.def" })).toEqual({ note: REDACTED });
    expect(redact({ value: "margaya_live_123" })).toEqual({ value: REDACTED });
    expect(redact({ value: "xoxb-1234-5678" })).toEqual({ value: REDACTED });
    expect(redact({ value: "ghp_abcdefghijklmnop" })).toEqual({
      value: REDACTED,
    });
    expect(redact({ value: "https://user:pass@example.com/x?y=1" })).toEqual({
      value: "https://example.com/…",
    });
  });

  it("bounds long strings, arrays and depth", () => {
    const long = "x".repeat(2000);
    expect((redact(long) as string).length).toBeLessThanOrEqual(501);
    expect(
      (redact(Array.from({ length: 200 }, (_, i) => i)) as []).length,
    ).toBe(50);
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(JSON.stringify(redact(deep))).toContain("…");
  });

  it("returns null metadata when nothing is left", () => {
    expect(redactMetadata(null)).toBeNull();
    expect(redactMetadata({})).toBeNull();
    expect(redactMetadata({ when: new Date("2026-01-01T00:00:00Z") })).toEqual({
      when: "2026-01-01T00:00:00.000Z",
    });
  });

  it("keeps only the origin of a URL", () => {
    expect(
      redactUrl("https://hooks.example.com/services/T0/B0/secret?x=1"),
    ).toBe("https://hooks.example.com/…");
    expect(redactUrl("https://example.com/")).toBe("https://example.com");
    expect(redactUrl("not a url")).toBe(REDACTED);
  });

  it("diffs changed fields with before and after, hiding secret values", () => {
    expect(
      diffFields(
        { name: "Old", url: "https://a.example", secret: "s1", same: 1 },
        { name: "New", url: "https://a.example", secret: "s2", same: 1 },
      ),
    ).toEqual({
      name: { before: "Old", after: "New" },
      secret: REDACTED,
    });
    expect(diffFields({ events: ["*"] }, { events: ["*"] })).toEqual({});
  });
});

describe("audit log helpers", () => {
  it("reads AUDIT_LOG_RETENTION_DAYS with a 365-day default and 0 for forever", () => {
    expect(auditLogRetentionDays(undefined)).toBe(365);
    expect(auditLogRetentionDays("")).toBe(365);
    expect(auditLogRetentionDays("abc")).toBe(365);
    expect(auditLogRetentionDays("-3")).toBe(365);
    expect(auditLogRetentionDays("0")).toBe(0);
    expect(auditLogRetentionDays(" 30 ")).toBe(30);
  });

  it("lists permission grants added and removed", () => {
    expect(
      permissionChanges(
        { task: ["read", "update"], project: ["read"] },
        { task: ["read", "delete"], audit_log: ["read"] },
      ),
    ).toEqual({
      added: ["audit_log:read", "task:delete"],
      removed: ["project:read", "task:update"],
    });
  });
});

describe("audit actions", () => {
  it("has an English sentence for every action the API records", async () => {
    const { AUDIT_ACTIONS } = await import(
      "../../../apps/api/src/audit-log/actions"
    );
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const en = JSON.parse(
      readFileSync(resolve(__dirname, "../../../i18n/en-US.json"), "utf8"),
    );
    const sentences = en.settings.workspaceAuditLog.actions as Record<
      string,
      string
    >;
    const camel = (action: string) =>
      action.replace(/[._]([a-z])/g, (_: string, char: string) =>
        char.toUpperCase(),
      );
    for (const action of AUDIT_ACTIONS) {
      expect(sentences[camel(action)], action).toBeTruthy();
    }
  });
});
