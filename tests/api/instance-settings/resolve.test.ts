import { describe, expect, it, vi } from "vitest";
import { SETTINGS_CATALOG } from "../../../apps/api/src/instance-settings/catalog";
import {
  resolveInstanceSettings,
  type StoredSetting,
} from "../../../apps/api/src/instance-settings/resolve";

function row(key: string, value: StoredSetting["value"]): StoredSetting {
  return {
    key,
    value,
    unreadable: false,
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    updatedBy: { id: "admin", name: "Admin" },
  };
}

function resolve(env: Record<string, string> = {}, rows: StoredSetting[] = []) {
  return resolveInstanceSettings({ env, rows });
}

describe("precedence", () => {
  it("uses defaults with an empty environment and no rows", () => {
    const snapshot = resolve();
    expect(Object.keys(snapshot.settings)).toHaveLength(
      SETTINGS_CATALOG.length,
    );
    for (const entry of SETTINGS_CATALOG) {
      expect(snapshot.settings[entry.key]).toMatchObject({
        value: entry.default,
        source: "default",
        locked: false,
        envVar: null,
      });
    }
    expect(snapshot.locked).toBe(false);
  });

  it.each([
    // [global lock, own variable, row] → source, locked, value
    [false, false, false, "default", false, false],
    [false, false, true, "database", false, true],
    [false, true, false, "environment", true, true],
    [false, true, true, "environment", true, true],
    [true, false, false, "default", true, false],
    [true, false, true, "default", true, false],
    [true, true, false, "environment", true, true],
    [true, true, true, "environment", true, true],
  ] as const)(
    "lock=%s env=%s row=%s → %s locked=%s value=%s",
    (lock, ownVar, hasRow, source, locked, value) => {
      const env: Record<string, string> = {};
      if (lock) env.MARGAYA_LOCK_INSTANCE_SETTINGS = "true";
      if (ownVar) env.DISABLE_REGISTRATION = "true";
      const rows = hasRow ? [row("auth.inviteOnly", true)] : [];
      const setting = resolve(env, rows).settings["auth.inviteOnly"];
      expect(setting).toMatchObject({ source, locked, value });
    },
  );

  it("locks a whole credential group from its client id variable", () => {
    const snapshot = resolve({ GOOGLE_CLIENT_ID: "gid" }, [
      row("oauth.google.clientSecret", "from-db"),
      row("oauth.google.enabled", false),
    ]);
    expect(snapshot.settings["oauth.google.clientId"]).toMatchObject({
      value: "gid",
      locked: true,
      envVar: "GOOGLE_CLIENT_ID",
    });
    // A group key whose own variable is missing takes its default.
    expect(snapshot.settings["oauth.google.clientSecret"]).toMatchObject({
      value: "",
      source: "environment",
      locked: true,
      envVar: "GOOGLE_CLIENT_ID",
    });
    // The enabled switch has no variable: still the panel's.
    expect(snapshot.settings["oauth.google.enabled"]).toMatchObject({
      value: false,
      source: "database",
      locked: false,
    });
  });

  it("does not lock a group member from its own variable alone", () => {
    const snapshot = resolve({ SMTP_USER: "env-user" }, [
      row("smtp.user", "db-user"),
    ]);
    expect(snapshot.settings["smtp.user"]).toMatchObject({
      value: "db-user",
      source: "database",
      locked: false,
    });
  });

  it("follows the GitHub helper's precedence", () => {
    const both = resolve({
      GITHUB_OAUTH_CLIENT_ID: "oauth-id",
      GITHUB_OAUTH_CLIENT_SECRET: "oauth-secret",
      GITHUB_CLIENT_ID: "legacy-id",
      GITHUB_CLIENT_SECRET: "legacy-secret",
    });
    expect(both.oauth.github).toEqual({
      clientId: "oauth-id",
      clientSecret: "oauth-secret",
    });
    const legacy = resolve({
      GITHUB_CLIENT_ID: "legacy-id",
      GITHUB_CLIENT_SECRET: "legacy-secret",
    });
    expect(legacy.oauth.github).toEqual({
      clientId: "legacy-id",
      clientSecret: "legacy-secret",
    });
    expect(legacy.settings["oauth.github.clientId"]?.envVar).toBe(
      "GITHUB_CLIENT_ID",
    );
    expect(legacy.derived.providers.github.envVars).toEqual([
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
    ]);
  });

  it("treats a blank variable as unset", () => {
    const snapshot = resolve({ DISABLE_REGISTRATION: "  " }, [
      row("auth.inviteOnly", true),
    ]);
    expect(snapshot.settings["auth.inviteOnly"]).toMatchObject({
      value: true,
      source: "database",
    });
  });

  it("falls through an invalid stored row with a warning", () => {
    const warn = vi.fn();
    const snapshot = resolveInstanceSettings({
      env: {},
      rows: [row("general.instanceName", "x".repeat(81))],
      warn,
    });
    expect(snapshot.settings["general.instanceName"]).toMatchObject({
      value: "Margaya",
      source: "default",
    });
    expect(warn).toHaveBeenCalledWith(
      "general.instanceName",
      expect.any(String),
    );
  });

  it("flags an unreadable secret and falls back", () => {
    const snapshot = resolve({}, [
      { ...row("smtp.password", null), unreadable: true },
    ]);
    expect(snapshot.settings["smtp.password"]).toMatchObject({
      value: "",
      source: "default",
      unreadable: true,
      configured: false,
    });
  });
});

describe("environment parsing", () => {
  it.each([
    ["true", false],
    ["false", true],
    ["yes", true],
  ])("DISABLE_LOGIN_FORM=%s → email sign-in %s", (raw, expected) => {
    const setting = resolve({ DISABLE_LOGIN_FORM: raw }).settings[
      "auth.emailSignIn"
    ];
    expect(setting).toMatchObject({ value: expected, locked: true });
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("DISABLE_WORKSPACE_CREATION=%s → restricted %s", (raw, expected) => {
    expect(
      resolve({ DISABLE_WORKSPACE_CREATION: raw }).effective
        .restrictWorkspaceCreation,
    ).toBe(expected);
  });

  it.each([
    [{}, "tls"],
    [{ SMTP_SECURE: "true" }, "tls"],
    [{ SMTP_SECURE: "false" }, "starttls"],
    [{ SMTP_SECURE: "false", SMTP_REQUIRE_TLS: "false" }, "none"],
  ])("maps the SMTP security flags %j → %s", (flags, security) => {
    const snapshot = resolve({ SMTP_HOST: "smtp.example.test", ...flags });
    expect(snapshot.effective.smtp.security).toBe(security);
  });

  it("keeps today's custom OAuth defaults", () => {
    const snapshot = resolve({
      CUSTOM_OAUTH_CLIENT_ID: "cid",
      CUSTOM_OAUTH_CLIENT_SECRET: "secret",
      CUSTOM_OAUTH_SCOPES: "openid, profile ,email",
      CUSTOM_AUTH_PKCE: "false",
    });
    expect(snapshot.oauth.custom).toMatchObject({
      clientId: "cid",
      clientSecret: "secret",
      scopes: ["openid", "profile", "email"],
      responseType: "code",
      pkce: false,
    });
    // Environment-managed custom OAuth keeps today's "id and secret" rule.
    expect(snapshot.derived.providers.custom).toMatchObject({
      configured: true,
      active: true,
      managedByEnvironment: true,
    });
    expect(resolve().oauth.custom.scopes).toEqual(["profile", "email"]);
  });
});

describe("derived values", () => {
  it("applies today's guest rule", () => {
    expect(resolve().derived.guestAccessActive).toBe(true);
    for (const key of [
      "DISABLE_GUEST_ACCESS",
      "DISABLE_REGISTRATION",
      "DISABLE_PASSWORD_REGISTRATION",
      "DISABLE_LOGIN_FORM",
    ]) {
      expect(resolve({ [key]: "true" }).derived.guestAccessActive).toBe(false);
    }
  });

  it("needs endpoints for a panel-configured custom provider", () => {
    const credentials = [
      row("oauth.custom.clientId", "cid"),
      row("oauth.custom.clientSecret", "secret"),
    ];
    expect(resolve({}, credentials).derived.providers.custom.configured).toBe(
      false,
    );
    expect(
      resolve({}, [
        ...credentials,
        row("oauth.custom.discoveryUrl", "https://id.example.test/.well-known"),
      ]).derived.providers.custom.configured,
    ).toBe(true);
    const threeEndpoints = [
      ...credentials,
      row("oauth.custom.authorizationUrl", "https://id.example.test/auth"),
      row("oauth.custom.tokenUrl", "https://id.example.test/token"),
    ];
    expect(
      resolve({}, threeEndpoints).derived.providers.custom.configured,
    ).toBe(false);
    expect(
      resolve({}, [
        ...threeEndpoints,
        row("oauth.custom.userInfoUrl", "https://id.example.test/me"),
      ]).derived.providers.custom.configured,
    ).toBe(true);
  });

  it("counts active sign-in methods", () => {
    expect(resolve().derived.signInMethodsActive).toBe(1);
    const google = { GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s" };
    expect(resolve(google).derived.signInMethodsActive).toBe(2);
    expect(
      resolve(google, [row("oauth.google.enabled", false)]).derived
        .signInMethodsActive,
    ).toBe(1);
    expect(
      resolve({ DISABLE_LOGIN_FORM: "true" }).derived.signInMethodsActive,
    ).toBe(0);
  });

  it("needs host and sender for SMTP and email sign-in for codes", () => {
    const smtp = {
      SMTP_HOST: "smtp.example.test",
      SMTP_FROM: "a@example.test",
    };
    expect(resolve({ SMTP_HOST: "h" }).derived.smtpConfigured).toBe(false);
    expect(resolve(smtp).derived).toMatchObject({
      smtpConfigured: true,
      emailCodeActive: true,
    });
    expect(
      resolve({ ...smtp, DISABLE_EMAIL_OTP_SIGN_IN: "true" }).derived
        .emailCodeActive,
    ).toBe(false);
  });

  it("builds callback URLs from the API origin", () => {
    const providers = resolve({
      MARGAYA_API_URL: "https://api.example.test/api",
    }).derived.providers;
    expect(providers.github.callbackUrl).toBe(
      "https://api.example.test/api/auth/callback/github",
    );
    expect(providers.custom.callbackUrl).toBe(
      "https://api.example.test/api/auth/oauth2/callback/custom",
    );
  });

  it("changes the OAuth fingerprint only for credentials and endpoints", () => {
    const base = resolve().oauthFingerprint;
    expect(resolve().oauthFingerprint).toBe(base);
    expect(
      resolve({}, [row("oauth.github.enabled", false)]).oauthFingerprint,
    ).toBe(base);
    expect(
      resolve({}, [row("general.instanceName", "Acme")]).oauthFingerprint,
    ).toBe(base);
    expect(
      resolve({}, [row("oauth.github.clientId", "new")]).oauthFingerprint,
    ).not.toBe(base);
  });
});
