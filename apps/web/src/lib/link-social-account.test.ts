import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ linkSocial: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { linkSocial: mocks.linkSocial },
}));

import { linkSocialAccount } from "./link-social-account";

function enterDesktopApp(value: unknown) {
  Object.defineProperty(window, "__MARGAYA_DESKTOP__", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, "__MARGAYA_DESKTOP__");
  vi.clearAllMocks();
});

const GITHUB = "https://github.com/login/oauth/authorize?client_id=x&state=y";

describe("linking a social account", () => {
  it("lets Better Auth redirect the page in a browser", async () => {
    mocks.linkSocial.mockResolvedValue({
      data: { url: GITHUB, redirect: true },
      error: null,
    });
    await linkSocialAccount("github", "http://localhost:3000/settings");
    expect(mocks.linkSocial).toHaveBeenCalledWith({
      provider: "github",
      callbackURL: "http://localhost:3000/settings",
    });
  });

  it("keeps the redirect in a desktop app without the sign-in popup", async () => {
    enterDesktopApp({ version: "0.1.0", platform: "windows" });
    mocks.linkSocial.mockResolvedValue({
      data: { url: GITHUB, redirect: true },
      error: null,
    });
    await linkSocialAccount("github", "http://localhost:3000/settings");
    expect(mocks.linkSocial.mock.calls[0]?.[0]).not.toHaveProperty(
      "disableRedirect",
    );
  });

  it("opens the provider in the desktop app's sign-in popup", async () => {
    const openSignInPopup = vi.fn();
    enterDesktopApp({ openSignInPopup });
    mocks.linkSocial.mockResolvedValue({
      data: { url: GITHUB, redirect: false },
      error: null,
    });
    const onReturn = vi.fn();
    await linkSocialAccount("github", "http://localhost:3000/s", onReturn);
    expect(mocks.linkSocial).toHaveBeenCalledWith({
      provider: "github",
      callbackURL: "http://localhost:3000/s",
      disableRedirect: true,
    });
    expect(openSignInPopup).toHaveBeenCalledWith(GITHUB);
    // The page refreshes the link once the popup closes and focus is back.
    expect(onReturn).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("focus"));
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it("never hands the popup anything but an http(s) URL", async () => {
    const openSignInPopup = vi.fn();
    enterDesktopApp({ openSignInPopup });
    mocks.linkSocial.mockResolvedValue({
      data: { url: "javascript:alert(1)", redirect: false },
      error: null,
    });
    await expect(
      linkSocialAccount("github", "http://localhost:3000/s"),
    ).rejects.toThrow();
    expect(openSignInPopup).not.toHaveBeenCalled();
  });

  it("reports Better Auth's error", async () => {
    enterDesktopApp({ openSignInPopup: vi.fn() });
    mocks.linkSocial.mockResolvedValue({
      data: null,
      error: { message: "Provider not found" },
    });
    await expect(
      linkSocialAccount("github", "http://localhost:3000/s"),
    ).rejects.toThrow("Provider not found");
  });
});
