import { describe, expect, it } from "vitest";
import {
  hashTrialEmail,
  normalizeTrialEmail,
} from "../../../apps/api/src/billing/trial-identity";

describe("normalizeTrialEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeTrialEmail("  Alex@Margaya.APP ")).toBe("alex@margaya.app");
  });

  it("drops plus tags so aliases share one trial", () => {
    expect(normalizeTrialEmail("alex+trial2@margaya.app")).toBe(
      "alex@margaya.app",
    );
  });

  it("keeps the address when stripping would empty the local part", () => {
    expect(normalizeTrialEmail("+tag@margaya.app")).toBe("+tag@margaya.app");
  });

  it("leaves values without an address shape alone", () => {
    expect(normalizeTrialEmail("not-an-email")).toBe("not-an-email");
  });
});

describe("hashTrialEmail", () => {
  it("matches for addresses that normalize to the same mailbox", () => {
    expect(hashTrialEmail("Alex+one@margaya.app")).toBe(
      hashTrialEmail("alex@margaya.app"),
    );
  });

  it("differs for different mailboxes", () => {
    expect(hashTrialEmail("a@margaya.app")).not.toBe(
      hashTrialEmail("b@margaya.app"),
    );
  });

  it("does not store the address itself", () => {
    expect(hashTrialEmail("alex@margaya.app")).not.toContain("margaya");
  });
});
