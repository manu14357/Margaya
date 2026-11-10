import { describe, expect, it } from "vitest";
import {
  desktopAuthorizeRedirect,
  desktopAuthorizeReturnPath,
  isDesktopCallbackUrl,
  parseDesktopAuthorizeRequest,
} from "./desktop-authorize";

const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const request = {
  state: "state-1234",
  code_challenge: CHALLENGE,
  code_challenge_method: "S256" as const,
};

describe("parseDesktopAuthorizeRequest", () => {
  it("accepts a well-formed S256 request", () => {
    expect(parseDesktopAuthorizeRequest(request)).toEqual(request);
  });

  it.each([
    { ...request, code_challenge_method: "plain" },
    { ...request, state: "short" },
    { ...request, state: "has space here" },
    { ...request, code_challenge: "too-short" },
    { ...request, state: undefined },
  ])("refuses %o", (search) => {
    expect(parseDesktopAuthorizeRequest(search)).toBeNull();
  });
});

describe("desktopAuthorizeRedirect", () => {
  it("returns this page with its query, for the sign-in page to come back to", () => {
    const path = desktopAuthorizeReturnPath(request, "code");
    expect(path).toBe(
      `/desktop/authorize?state=state-1234&code_challenge=${CHALLENGE}&code_challenge_method=S256&display=code`,
    );
    expect(desktopAuthorizeRedirect(path)).toBe(path);
  });

  it.each([
    undefined,
    42,
    "/dashboard",
    "/desktop/authorize/../dashboard",
    "//evil.example/desktop/authorize",
    "/\\evil.example/desktop/authorize",
    "https://evil.example/desktop/authorize",
  ])("ignores %s", (redirect) => {
    expect(desktopAuthorizeRedirect(redirect)).toBeNull();
  });
});

describe("isDesktopCallbackUrl", () => {
  it("accepts only the desktop app's scheme", () => {
    expect(
      isDesktopCallbackUrl(
        "com.margaya.desktop://auth/callback?code=c&state=s",
      ),
    ).toBe(true);
    expect(isDesktopCallbackUrl("https://evil.example/")).toBe(false);
    expect(isDesktopCallbackUrl("javascript:alert(1)")).toBe(false);
    expect(isDesktopCallbackUrl(undefined)).toBe(false);
  });
});
