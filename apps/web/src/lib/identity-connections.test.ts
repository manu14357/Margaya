import enUS from "@i18n/en-US.json";
import { describe, expect, it } from "vitest";
import {
  areValidDomains,
  certificateStatus,
  isSafeSignOnUrl,
  parseDomains,
} from "./identity-connections";

describe("parseDomains", () => {
  it("splits on commas and spaces, lowercases and drops repeats", () => {
    expect(parseDomains(" Acme.example, b.example  acme.example,, ")).toEqual([
      "acme.example",
      "b.example",
    ]);
  });

  it("gives nothing for nothing", () => {
    expect(parseDomains("  , ")).toEqual([]);
  });
});

describe("areValidDomains", () => {
  it("takes real domains, including subdomains", () => {
    expect(areValidDomains(["acme.example", "eu.acme.example"])).toBe(true);
  });

  it("refuses none at all, a bare word, an address and a wildcard", () => {
    expect(areValidDomains([])).toBe(false);
    expect(areValidDomains(["acme"])).toBe(false);
    expect(areValidDomains(["pat@acme.example"])).toBe(false);
    expect(areValidDomains(["*.acme.example"])).toBe(false);
  });
});

describe("isSafeSignOnUrl", () => {
  it("takes https anywhere and http only on this machine", () => {
    expect(isSafeSignOnUrl("https://idp.example/sso")).toBe(true);
    expect(isSafeSignOnUrl("http://localhost:8080/sso")).toBe(true);
    expect(isSafeSignOnUrl("http://127.0.0.1/sso")).toBe(true);
    expect(isSafeSignOnUrl("http://idp.example/sso")).toBe(false);
  });

  it("refuses other schemes and non-addresses", () => {
    expect(isSafeSignOnUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeSignOnUrl("idp.example/sso")).toBe(false);
  });
});

describe("certificateStatus", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("warns in the last 30 days and after the end", () => {
    expect(certificateStatus("2027-01-01T00:00:00Z", now)).toBe("valid");
    expect(certificateStatus("2026-01-20T00:00:00Z", now)).toBe("expiring");
    expect(certificateStatus("2025-12-31T00:00:00Z", now)).toBe("expired");
  });
});

// The API's SAML refusals reach the sign-in screen as ?error=, which looks up
// auth.signIn.errors with this same normalization.
describe("SAML refusals on the sign-in screen", () => {
  it.each([
    "unsolicited_response",
    "invalid_saml_response",
    "saml_deprecated_algorithm",
    "saml_other_browser",
    "replay_detected",
    "BANNED_USER",
    "account_not_linked",
    "unable_to_create_user",
    "unable_to_link_account",
    "This_identity_provider_cannot_sign_in_that_email_address.",
    "New_accounts_on_this_server_must_use_an_approved_email_domain.",
    "Registration_is_currently_disabled._You_need_a_valid_invitation_to_create_an_account.",
  ])("has words for %s", (code) => {
    const key = code.replace(/[._]+/g, "_").toLowerCase();
    expect(enUS.auth.signIn.errors).toHaveProperty([key]);
  });
});
