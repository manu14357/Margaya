import { describe, expect, it } from "vitest";
import type {
  InstanceProviderState,
  InstanceSettingEntry,
  InstanceSettings,
} from "@/types/instance-admin";
import {
  clearSmtpPatch,
  indexSettings,
  isValidFromAddress,
  isValidOptionalUrl,
  isValidSmtpHost,
  isValidSmtpPort,
  oauthDraftOf,
  oauthPatch,
  secretFieldState,
  secretPatchValue,
  settingsForPage,
  signInMethods,
  smtpFormValues,
  smtpPatch,
  sourceBadgeOf,
} from "./instance-settings";

function entry(
  key: string,
  group: string,
  value: string | number | boolean | undefined,
  overrides: Partial<InstanceSettingEntry> = {},
): InstanceSettingEntry {
  return {
    key,
    group,
    ...(value === undefined ? {} : { value }),
    source: "default",
    locked: false,
    envVar: null,
    secret: value === undefined,
    configured: false,
    unreadable: false,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  } as InstanceSettingEntry;
}

function provider(
  overrides: Partial<InstanceProviderState> = {},
): InstanceProviderState {
  return {
    configured: false,
    enabled: true,
    active: false,
    managedByEnvironment: false,
    callbackUrl: "http://api.test/api/auth/callback/x",
    envVars: [],
    ...overrides,
  };
}

function settingsWith(
  entries: InstanceSettingEntry[],
  derived: Partial<InstanceSettings["derived"]> = {},
  locked = false,
): InstanceSettings {
  return {
    locked,
    settings: entries,
    derived: {
      smtpConfigured: false,
      guestAccessActive: true,
      emailCodeActive: false,
      signInMethodsActive: 1,
      providers: {
        github: provider(),
        google: provider(),
        discord: provider(),
        custom: provider(),
      },
      ...derived,
    },
  };
}

const AUTH_ENTRIES = [
  entry("auth.emailSignIn", "signIn", true),
  entry("auth.emailCodeSignIn", "signIn", true),
  entry("oauth.github.enabled", "oauth.github", true),
  entry("oauth.google.enabled", "oauth.google", true),
  entry("oauth.discord.enabled", "oauth.discord", true),
  entry("oauth.custom.enabled", "oauth.custom", true),
];

describe("page grouping", () => {
  it("puts each catalog group on its page", () => {
    const all = [
      entry("general.instanceName", "general", "Acme"),
      entry("auth.inviteOnly", "signUp", false),
      entry("oauth.custom.scopes", "oauth.custom", "profile,email"),
      entry("smtp.host", "smtp", ""),
      entry("workspaces.restrictCreation", "workspaces", false),
      entry("publicBoards.enabled", "publicBoards", true),
    ];
    expect(settingsForPage(all, "general").map((e) => e.key)).toEqual([
      "general.instanceName",
    ]);
    expect(settingsForPage(all, "authentication").map((e) => e.key)).toEqual([
      "auth.inviteOnly",
      "oauth.custom.scopes",
    ]);
    expect(settingsForPage(all, "email").map((e) => e.key)).toEqual([
      "smtp.host",
    ]);
    expect(settingsForPage(all, "admins")).toEqual([]);
  });
});

describe("source badges", () => {
  it("names the locking variable for environment values", () => {
    expect(
      sourceBadgeOf({ source: "environment", envVar: "SMTP_HOST" }),
    ).toEqual({
      kind: "environment",
      labelKey: "instanceAdmin:source.environment",
      tooltipKey: "instanceAdmin:source.lockTooltip",
      variable: "SMTP_HOST",
    });
  });

  it("says who saved a value when it knows", () => {
    const badge = sourceBadgeOf({
      source: "database",
      envVar: null,
      updatedAt: "2026-10-01T10:00:00.000Z",
      updatedBy: { name: "Olivia" },
    });
    expect(badge).toMatchObject({
      kind: "saved",
      tooltipKey: "instanceAdmin:source.savedBy",
      by: "Olivia",
    });
    expect(
      sourceBadgeOf({ source: "database", envVar: null, updatedBy: null }),
    ).toMatchObject({ kind: "saved", tooltipKey: null });
  });

  it("falls back to the default badge", () => {
    expect(sourceBadgeOf({ source: "default", envVar: null }).kind).toBe(
      "default",
    );
  });
});

describe("secret fields", () => {
  it("derives the state from the flags, never a value", () => {
    expect(
      secretFieldState({ configured: false, unreadable: false }, false),
    ).toBe("empty");
    expect(
      secretFieldState({ configured: true, unreadable: false }, false),
    ).toBe("saved");
    expect(
      secretFieldState({ configured: true, unreadable: false }, true),
    ).toBe("replacing");
    expect(
      secretFieldState({ configured: false, unreadable: true }, true),
    ).toBe("unreadable");
  });

  it("only sends a typed secret", () => {
    expect(secretPatchValue("")).toBeUndefined();
    expect(secretPatchValue("   ")).toBeUndefined();
    expect(secretPatchValue(" s3cret ")).toBe(" s3cret ");
  });
});

describe("sign-in methods", () => {
  it("blocks turning off the last active method", () => {
    const methods = signInMethods(settingsWith(AUTH_ENTRIES));
    const email = methods.find((m) => m.id === "emailPassword");
    expect(email).toMatchObject({ status: "active", isLastActive: true });
    expect(methods.find((m) => m.id === "github")).toMatchObject({
      status: "notConfigured",
      isLastActive: false,
      isProvider: true,
    });
  });

  it("frees email sign-in once a provider is active too", () => {
    const methods = signInMethods(
      settingsWith(AUTH_ENTRIES, {
        signInMethodsActive: 2,
        providers: {
          github: provider({ configured: true, active: true }),
          google: provider({ configured: true, enabled: false }),
          discord: provider(),
          custom: provider(),
        },
      }),
    );
    expect(methods.find((m) => m.id === "emailPassword")?.isLastActive).toBe(
      false,
    );
    expect(methods.find((m) => m.id === "github")?.status).toBe("active");
    expect(methods.find((m) => m.id === "google")?.status).toBe("off");
  });

  it("says email codes need email setup", () => {
    const methods = signInMethods(settingsWith(AUTH_ENTRIES));
    expect(methods.find((m) => m.id === "emailCode")?.status).toBe(
      "needsEmail",
    );
    const ready = signInMethods(
      settingsWith(AUTH_ENTRIES, { smtpConfigured: true }),
    );
    expect(ready.find((m) => m.id === "emailCode")?.status).toBe("active");
  });

  it("marks environment-locked methods", () => {
    const entries = AUTH_ENTRIES.map((e) =>
      e.key === "auth.emailCodeSignIn"
        ? {
            ...e,
            value: false,
            source: "environment" as const,
            locked: true,
            envVar: "DISABLE_EMAIL_OTP_SIGN_IN",
          }
        : e,
    );
    const code = signInMethods(settingsWith(entries)).find(
      (m) => m.id === "emailCode",
    );
    expect(code).toMatchObject({
      locked: true,
      envVar: "DISABLE_EMAIL_OTP_SIGN_IN",
      status: "off",
    });
  });

  it("locks everything under the global lock", () => {
    const methods = signInMethods(settingsWith(AUTH_ENTRIES, {}, true));
    expect(methods.every((m) => m.locked)).toBe(true);
  });
});

describe("SMTP form", () => {
  const index = indexSettings(
    settingsWith([
      entry("smtp.host", "smtp", "mail.example.com"),
      entry("smtp.port", "smtp", 0),
      entry("smtp.security", "smtp", "starttls"),
      entry("smtp.user", "smtp", "bot"),
      entry("smtp.password", "smtp", undefined, { configured: true }),
      entry("smtp.from", "smtp", "Acme <bot@example.com>"),
    ]),
  );

  it("shows port 0 as an empty field (the default port)", () => {
    expect(smtpFormValues(index)).toEqual({
      host: "mail.example.com",
      port: "",
      security: "starttls",
      user: "bot",
      from: "Acme <bot@example.com>",
    });
  });

  it("patches only changed fields, clearing blanks", () => {
    const initial = smtpFormValues(index);
    expect(smtpPatch(initial, initial)).toEqual({});
    expect(
      smtpPatch(
        { ...initial, port: "587", user: "", host: " h.test " },
        initial,
      ),
    ).toEqual({ "smtp.port": 587, "smtp.user": null, "smtp.host": "h.test" });
    expect(
      smtpPatch({ ...initial, port: "" }, { ...initial, port: "25" }),
    ).toEqual({ "smtp.port": null });
    expect(smtpPatch(initial, initial, "pw")).toEqual({
      "smtp.password": "pw",
    });
  });

  it("clears every SMTP key on remove", () => {
    expect(clearSmtpPatch()).toEqual({
      "smtp.host": null,
      "smtp.port": null,
      "smtp.security": null,
      "smtp.user": null,
      "smtp.password": null,
      "smtp.from": null,
    });
  });

  it("validates like the server", () => {
    expect(isValidSmtpHost("smtp.example.com")).toBe(true);
    expect(isValidSmtpHost("")).toBe(true);
    expect(isValidSmtpHost("smtp://example.com")).toBe(false);
    expect(isValidSmtpPort("")).toBe(true);
    expect(isValidSmtpPort("0")).toBe(false);
    expect(isValidSmtpPort("65536")).toBe(false);
    expect(isValidSmtpPort("465")).toBe(true);
    expect(isValidFromAddress("Margaya <no-reply@example.com>")).toBe(true);
    expect(isValidFromAddress("no-reply@example.com")).toBe(true);
    expect(isValidFromAddress("Margaya")).toBe(false);
  });
});

describe("OAuth provider form", () => {
  const index = indexSettings(
    settingsWith([
      entry("oauth.custom.clientId", "oauth.custom", "abc"),
      entry("oauth.custom.scopes", "oauth.custom", "profile,email"),
      entry("oauth.custom.pkce", "oauth.custom", true),
      entry("oauth.custom.autoSignIn", "oauth.custom", false),
      entry("oauth.github.clientId", "oauth.github", ""),
    ]),
  );

  it("sends only provider credentials for built-in providers", () => {
    const initial = oauthDraftOf(index, "github");
    expect(
      oauthPatch(
        "github",
        { ...initial, clientId: "id", scopes: "x" },
        initial,
        "sec",
      ),
    ).toEqual({
      "oauth.github.clientId": "id",
      "oauth.github.clientSecret": "sec",
    });
  });

  it("sends changed custom fields", () => {
    const initial = oauthDraftOf(index, "custom");
    expect(initial.scopes).toBe("profile, email");
    expect(
      oauthPatch(
        "custom",
        {
          ...initial,
          buttonLabel: "Continue with Okta",
          pkce: false,
          clientId: "",
        },
        initial,
      ),
    ).toEqual({
      "oauth.custom.buttonLabel": "Continue with Okta",
      "oauth.custom.pkce": false,
      "oauth.custom.clientId": null,
    });
  });

  it("accepts only absolute http(s) URLs", () => {
    expect(isValidOptionalUrl("")).toBe(true);
    expect(isValidOptionalUrl("https://id.example.com/.well-known")).toBe(true);
    expect(isValidOptionalUrl("ftp://x")).toBe(false);
    expect(isValidOptionalUrl("example.com")).toBe(false);
  });
});
