import { describe, expect, it } from "vitest";
import { SETTINGS_CATALOG } from "../../../apps/api/src/instance-settings/catalog";
import { resolveInstanceSettings } from "../../../apps/api/src/instance-settings/resolve";
import {
  emailDomainAllowed,
  emailDomainOf,
} from "../../../apps/api/src/utils/email-domains";
import { sessionTimingOf } from "../../../apps/api/src/utils/sign-in-policy";

const entry = (key: string) => {
  const found = SETTINGS_CATALOG.find((item) => item.key === key);
  if (!found) throw new Error(key);
  return found;
};

describe("email domains", () => {
  it("matches exact domains only, case-insensitively", () => {
    expect(emailDomainOf("A@Example.COM")).toBe("example.com");
    expect(emailDomainAllowed("a@example.com", [])).toBe(true);
    expect(emailDomainAllowed("a@EXAMPLE.com", ["example.com"])).toBe(true);
    expect(emailDomainAllowed("a@sub.example.com", ["example.com"])).toBe(
      false,
    );
    expect(emailDomainAllowed("no-at-sign", ["example.com"])).toBe(false);
  });

  it("normalizes the saved list and rejects junk", () => {
    const schema = entry("auth.allowedEmailDomains").schema;
    expect(schema.parse(" Acme.test, @corp.test acme.test")).toBe(
      "acme.test,corp.test",
    );
    expect(schema.safeParse("not a domain!").success).toBe(false);
  });

  it("reads the environment variables", () => {
    const snapshot = resolveInstanceSettings({
      env: {
        ALLOWED_EMAIL_DOMAINS: "Acme.test",
        REQUIRED_SIGN_IN_PROVIDER: "GitHub",
        SESSION_LIFETIME_HOURS: "12",
        ALLOW_INVITED_PASSWORD_REGISTRATION: "true",
      },
      rows: [],
    });
    expect(snapshot.effective.allowedEmailDomains).toEqual(["acme.test"]);
    expect(snapshot.effective.requiredProvider).toBe("github");
    expect(snapshot.effective.sessionLifetimeHours).toBe(12);
    expect(snapshot.effective.emailSignUpForInvitations).toBe(true);
    expect(snapshot.settings["auth.requiredProvider"]?.locked).toBe(true);
  });

  it("defaults to no policy and a week-long session", () => {
    const { effective } = resolveInstanceSettings({ env: {}, rows: [] });
    expect(effective.allowedEmailDomains).toEqual([]);
    expect(effective.requiredProvider).toBeNull();
    expect(effective.sessionLifetimeHours).toBe(168);
    expect(effective.emailSignUpForInvitations).toBe(false);
  });
});

describe("session timing", () => {
  it("refreshes at most daily and well inside short lifetimes", () => {
    expect(sessionTimingOf(168)).toEqual({
      expiresIn: 168 * 3600,
      updateAge: 86_400,
    });
    expect(sessionTimingOf(1)).toEqual({ expiresIn: 3600, updateAge: 900 });
  });
});
