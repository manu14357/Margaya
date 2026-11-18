import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  githubPrivateKeyFromEnv,
  settingDefinition,
} from "../../../apps/api/src/instance-settings/catalog";
import {
  resolveInstanceSettings,
  type StoredSetting,
} from "../../../apps/api/src/instance-settings/resolve";

const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString()
  .trim();

function row(key: string, value: StoredSetting["value"]): StoredSetting {
  return {
    key,
    value,
    unreadable: false,
    updatedAt: new Date("2026-11-19T00:00:00Z"),
    updatedBy: { id: "admin", name: "Admin" },
  };
}

const SAVED = [
  row("githubApp.appId", "123456"),
  row("githubApp.appName", "margaya-local"),
  row("githubApp.privateKey", PEM),
  row("githubApp.webhookSecret", "webhook-secret"),
];

function resolve(env: Record<string, string> = {}, rows: StoredSetting[] = []) {
  return resolveInstanceSettings({
    env: { MARGAYA_API_URL: "https://api.example.com", ...env },
    rows,
  });
}

describe("GitHub App settings", () => {
  it("is not set up by default and shows the webhook URL", () => {
    const { derived, effective } = resolve();
    expect(derived.githubApp).toEqual({
      configured: false,
      managedByEnvironment: false,
      webhookUrl: "https://api.example.com/api/github-integration/webhook",
      envVars: [
        "GITHUB_APP_ID",
        "GITHUB_APP_NAME",
        "GITHUB_PRIVATE_KEY",
        "GITHUB_WEBHOOK_SECRET",
      ],
    });
    expect(effective.githubApp.appId).toBe("");
  });

  it("uses the values saved in the admin panel", () => {
    const { derived, effective } = resolve({}, SAVED);
    expect(derived.githubApp.configured).toBe(true);
    expect(effective.githubApp).toEqual({
      appId: "123456",
      appName: "margaya-local",
      privateKey: PEM,
      webhookSecret: "webhook-secret",
    });
  });

  it("reads a numeric App ID back as text", () => {
    // The value column is JSON, so a saved "123456" comes back as a number.
    const rows = [row("githubApp.appId", 123456), ...SAVED.slice(1)];
    const { derived, effective } = resolve({}, rows);
    expect(effective.githubApp.appId).toBe("123456");
    expect(derived.githubApp.configured).toBe(true);
  });

  it("needs the App ID, private key and webhook secret", () => {
    for (const missing of SAVED.filter(
      (entry) => entry.key !== "githubApp.appName",
    )) {
      const rows = SAVED.filter((entry) => entry !== missing);
      expect(resolve({}, rows).derived.githubApp.configured).toBe(false);
    }
  });

  it("lets the environment manage the whole App", () => {
    const { derived, effective, settings } = resolve(
      {
        GITHUB_APP_ID: "999",
        GITHUB_PRIVATE_KEY_BASE64: Buffer.from(PEM).toString("base64"),
        GITHUB_WEBHOOK_SECRET: "env-secret",
      },
      SAVED,
    );
    expect(effective.githubApp).toMatchObject({
      appId: "999",
      appName: "",
      privateKey: PEM,
      webhookSecret: "env-secret",
    });
    expect(derived.githubApp.managedByEnvironment).toBe(true);
    expect(derived.githubApp.envVars).toContain("GITHUB_PRIVATE_KEY_BASE64");
    for (const key of ["appId", "appName", "privateKey", "webhookSecret"]) {
      expect(settings[`githubApp.${key}`]).toMatchObject({
        source: "environment",
        locked: true,
      });
    }
  });
});

describe("GitHub App values from the panel", () => {
  const parse = (key: string, value: string) =>
    settingDefinition(key)?.schema.safeParse(value);

  it("accepts a pasted PEM with Windows line ends or literal \\n", () => {
    expect(parse("githubApp.privateKey", PEM.replace(/\n/g, "\r\n"))).toEqual({
      success: true,
      data: PEM,
    });
    expect(parse("githubApp.privateKey", PEM.replace(/\n/g, "\\n"))).toEqual({
      success: true,
      data: PEM,
    });
  });

  it("rejects text that isn't a private key", () => {
    expect(parse("githubApp.privateKey", "not a key")?.success).toBe(false);
    expect(
      parse("githubApp.privateKey", "http://localhost:1337/callback")?.success,
    ).toBe(false);
  });

  it("takes a numeric App ID and a slug", () => {
    expect(parse("githubApp.appId", " 123 ")).toEqual({
      success: true,
      data: "123",
    });
    expect(parse("githubApp.appId", "Iv23abc")?.success).toBe(false);
    expect(parse("githubApp.appName", "Margaya-Local")).toEqual({
      success: true,
      data: "margaya-local",
    });
    expect(parse("githubApp.appName", "Margaya Local")?.success).toBe(false);
  });
});

describe("the private key from the environment", () => {
  it("reads a multi-line PEM, a one-line PEM and base64", () => {
    expect(githubPrivateKeyFromEnv({ GITHUB_PRIVATE_KEY: PEM })).toBe(PEM);
    expect(
      githubPrivateKeyFromEnv({
        GITHUB_PRIVATE_KEY: PEM.replace(/\n/g, "\\n"),
      }),
    ).toBe(PEM);
    expect(
      githubPrivateKeyFromEnv({
        GITHUB_PRIVATE_KEY: "ignored",
        GITHUB_PRIVATE_KEY_BASE64: Buffer.from(PEM).toString("base64"),
      }),
    ).toBe(PEM);
    expect(githubPrivateKeyFromEnv({})).toBe("");
  });
});
