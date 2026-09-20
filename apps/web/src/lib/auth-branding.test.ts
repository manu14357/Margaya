import { describe, expect, it } from "vitest";
import {
  customInstanceName,
  customOAuthLabel,
  safeRedirectPath,
} from "./auth-branding";

describe("auth branding", () => {
  it("uses the instance name only when it was changed", () => {
    expect(customInstanceName(undefined)).toBeNull();
    expect(customInstanceName({ instanceName: "Margaya" })).toBeNull();
    expect(customInstanceName({ instanceName: "  " })).toBeNull();
    expect(customInstanceName({ instanceName: "Acme PM" })).toBe("Acme PM");
  });

  it("uses the custom OAuth label when one is set", () => {
    expect(customOAuthLabel({ customOAuthButtonLabel: null })).toBeNull();
    expect(customOAuthLabel({ customOAuthButtonLabel: "" })).toBeNull();
    expect(
      customOAuthLabel({ customOAuthButtonLabel: "Continue with Okta" }),
    ).toBe("Continue with Okta");
  });

  it("only follows same-origin redirects", () => {
    expect(safeRedirectPath("/public-project/abc?task=3")).toBe(
      "/public-project/abc?task=3",
    );
    expect(safeRedirectPath("//evil.example")).toBeUndefined();
    expect(safeRedirectPath("https://evil.example")).toBeUndefined();
    expect(safeRedirectPath(undefined)).toBeUndefined();
  });
});
