import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ linkSocial: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { linkSocial: mocks.linkSocial },
}));

import { linkSocialAccount, takeLinkError } from "./link-social-account";

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("linking a social account", () => {
  it("returns to the same page on success and on failure", async () => {
    mocks.linkSocial.mockResolvedValue({ data: {}, error: null });
    await linkSocialAccount("github", "http://localhost:3000/settings?tab=1");
    expect(mocks.linkSocial).toHaveBeenCalledWith({
      provider: "github",
      callbackURL: "http://localhost:3000/settings?tab=1",
      errorCallbackURL: "http://localhost:3000/settings?tab=1&linkError=github",
    });
  });

  it("throws Better Auth's error", async () => {
    mocks.linkSocial.mockResolvedValue({
      data: null,
      error: { message: "Provider not found" },
    });
    await expect(
      linkSocialAccount("github", "http://localhost:3000/settings"),
    ).rejects.toThrow("Provider not found");
  });
});

describe("reading a failed link", () => {
  it("returns the error code once and cleans the address", () => {
    window.history.replaceState(
      null,
      "",
      "/settings?tab=1&linkError=github&error=invalid_code",
    );
    expect(takeLinkError("github")).toBe("invalid_code");
    expect(window.location.search).toBe("?tab=1");
    expect(takeLinkError("github")).toBeNull();
  });

  it("ignores another provider's failure and plain pages", () => {
    window.history.replaceState(null, "", "/settings?linkError=google");
    expect(takeLinkError("github")).toBeNull();
    expect(window.location.search).toBe("?linkError=google");
    window.history.replaceState(null, "", "/settings?error=x");
    expect(takeLinkError("github")).toBeNull();
  });
});
