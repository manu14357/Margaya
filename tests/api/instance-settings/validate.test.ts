import { describe, expect, it } from "vitest";
import {
  resolveInstanceSettings,
  type StoredSetting,
} from "../../../apps/api/src/instance-settings/resolve";
import { planSettingsPatch } from "../../../apps/api/src/instance-settings/validate";

function row(key: string, value: StoredSetting["value"]): StoredSetting {
  return {
    key,
    value,
    unreadable: false,
    updatedAt: new Date(),
    updatedBy: null,
  };
}

function plan(
  values: Record<string, unknown>,
  env: Record<string, string> = {},
  rows: StoredSetting[] = [],
) {
  return planSettingsPatch({
    env,
    rows,
    current: resolveInstanceSettings({ env, rows }),
    values,
  });
}

describe("planSettingsPatch", () => {
  it("refuses everything under the global lock", () => {
    expect(
      plan(
        { "general.instanceName": "Acme" },
        {
          MARGAYA_LOCK_INSTANCE_SETTINGS: "true",
        },
      ),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses unknown keys", () => {
    expect(plan({ "auth.nope": true })).toEqual({
      ok: false,
      status: 400,
      message: "Unknown setting: auth.nope",
    });
  });

  it("refuses keys locked by the environment and names the variable", () => {
    expect(
      plan({ "auth.inviteOnly": true }, { DISABLE_REGISTRATION: "false" }),
    ).toEqual({
      ok: false,
      status: 409,
      message:
        "auth.inviteOnly is set by DISABLE_REGISTRATION. Remove the variable and restart to manage it here.",
    });
    expect(
      plan({ "smtp.password": "x" }, { SMTP_HOST: "smtp.example.test" }),
    ).toMatchObject({ status: 409 });
  });

  it.each([
    ["general.instanceName", "x".repeat(81)],
    ["general.instanceName", "   "],
    ["smtp.port", 0],
    ["smtp.port", 70000],
    ["smtp.from", "Margaya"],
    ["smtp.host", "smtp://example.test"],
    ["oauth.custom.discoveryUrl", "ftp://id.example.test"],
    ["oauth.custom.scopes", "a b"],
    ["smtp.security", "ssl"],
    ["auth.inviteOnly", "yes"],
  ])("rejects %s = %j", (key, value) => {
    const result = plan({ [key]: value });
    expect(result).toMatchObject({ ok: false, status: 400 });
    if (!result.ok) {
      expect(result.message).toMatch(new RegExp(`^Invalid value for ${key}: `));
    }
  });

  it("asks for null instead of an empty secret", () => {
    expect(plan({ "smtp.password": "" })).toEqual({
      ok: false,
      status: 400,
      message: "Use null to clear smtp.password",
    });
  });

  it("normalizes values and detects no-ops", () => {
    const result = plan({
      "general.instanceName": "  Acme  ",
      "oauth.custom.scopes": "openid , email",
      "smtp.from": "Acme <no-reply@acme.test>",
    });
    expect(result).toMatchObject({
      ok: true,
      changes: [
        { key: "general.instanceName", value: "Acme" },
        { key: "oauth.custom.scopes", value: "openid,email" },
        { key: "smtp.from", value: "Acme <no-reply@acme.test>" },
      ],
    });
    const stored = [row("general.instanceName", "Acme")];
    expect(
      plan(
        { "general.instanceName": "Acme", "auth.inviteOnly": null },
        {},
        stored,
      ),
    ).toMatchObject({ ok: true, changes: [] });
    expect(plan({ "general.instanceName": null }, {}, stored)).toMatchObject({
      ok: true,
      changes: [{ key: "general.instanceName", value: null }],
    });
  });

  it("guards the last sign-in method", () => {
    expect(plan({ "auth.emailSignIn": false })).toEqual({
      ok: false,
      status: 409,
      message: "Keep at least one way to sign in",
    });
    const google = { GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s" };
    expect(plan({ "auth.emailSignIn": false }, google)).toMatchObject({
      ok: true,
    });
    expect(
      plan({ "oauth.google.enabled": false }, google, [
        row("auth.emailSignIn", false),
      ]),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("lets an instance already at zero methods save other keys", () => {
    expect(
      plan({ "general.instanceName": "Acme" }, { DISABLE_LOGIN_FORM: "true" }),
    ).toMatchObject({ ok: true });
  });
});
