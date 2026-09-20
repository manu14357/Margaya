import { afterEach, describe, expect, it, vi } from "vitest";
import { handleUnauthorized } from "./http-error";
import { beginSignOut, endSignOut } from "./sign-out";

function stubLocation(path: string) {
  const url = new URL(path, "http://localhost");
  const replace = vi.fn();
  vi.stubGlobal("location", {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    replace,
  });
  return replace;
}

afterEach(() => {
  endSignOut();
  vi.unstubAllGlobals();
});

describe("handleUnauthorized", () => {
  it("sends a signed-out visitor to sign-in with a way back", () => {
    const replace = stubLocation("/dashboard/settings?tab=a");
    handleUnauthorized();
    expect(replace).toHaveBeenCalledWith(
      "/auth/sign-in?redirect=%2Fdashboard%2Fsettings%3Ftab%3Da",
    );
  });

  it("does nothing on an auth page, so it never redirects to itself", () => {
    const replace = stubLocation("/auth/sign-in");
    handleUnauthorized();
    expect(replace).not.toHaveBeenCalled();
  });

  it("stays quiet while a sign-out runs", () => {
    const replace = stubLocation("/dashboard");
    beginSignOut();
    handleUnauthorized();
    expect(replace).not.toHaveBeenCalled();
  });
});
