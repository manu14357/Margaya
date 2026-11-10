import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const $fetch = vi.fn();
const replace = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    $fetch: (path: string, options: unknown) => $fetch(path, options),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// The layout's language and theme menus have their own tests.
vi.mock("@/components/common/language-menu", () => ({
  LanguageMenu: () => null,
  ThemeMenu: () => null,
}));

/** A fresh copy of the route, as on a new page load. */
async function page() {
  vi.resetModules();
  const { Route } = await import("./complete");
  return (Route as unknown as { component: ComponentType }).component;
}

const ORIGIN = "https://app.margaya.example.com";
let address: { origin: string; pathname: string; search: string; hash: string };
const rewrite = vi.fn();

/** The browser arriving at `path` on the app. */
function arriveAt(path: string) {
  const url = new URL(path, ORIGIN);
  address = {
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
  vi.stubGlobal("location", {
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    replace,
    get hash() {
      return address.hash;
    },
  });
  vi.spyOn(window.history, "replaceState").mockImplementation(
    (_state, _title, next) => {
      rewrite(next);
      address.hash = new URL(String(next), ORIGIN).hash;
    },
  );
}

beforeEach(() => {
  $fetch.mockReset();
  replace.mockReset();
  rewrite.mockReset();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "__MARGAYA_DESKTOP__");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("finishing a provider sign-in in the app", () => {
  it("redeems the token once, drops it from the address and goes on", async () => {
    $fetch.mockResolvedValue({
      data: { redirectTo: `${ORIGIN}/dashboard/workspace/w1` },
      error: null,
    });
    arriveAt("/auth/complete#token=one-time-token");
    const Complete = await page();
    const { unmount } = render(<Complete />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/dashboard/workspace/w1"),
    );
    expect($fetch).toHaveBeenCalledTimes(1);
    expect($fetch).toHaveBeenCalledWith("/handoff/redeem", {
      method: "POST",
      body: { token: "one-time-token" },
    });
    expect(rewrite).toHaveBeenCalledWith("/auth/complete");
    expect(address.hash).toBe("");
    expect(screen.getByRole("status")).toHaveTextContent(
      "auth:complete.working",
    );

    // Mounted again on the same load (as React's development double run does):
    // the token isn't sent a second time.
    unmount();
    render(<Complete />);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
    expect($fetch).toHaveBeenCalledTimes(1);
  });

  it("never leaves the app, whatever it is told", async () => {
    $fetch.mockResolvedValue({
      data: { redirectTo: "https://elsewhere.example/phish" },
      error: null,
    });
    arriveAt("/auth/complete#token=one-time-token");
    const Complete = await page();
    render(<Complete />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("says so, and offers sign-in, when the token is refused", async () => {
    $fetch.mockResolvedValue({
      data: null,
      error: { status: 400, code: "SIGN_IN_HANDOFF_INVALID" },
    });
    arriveAt("/auth/complete#token=used-token");
    const Complete = await page();
    render(<Complete />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "auth:complete.failed",
    );
    expect(screen.getByText("auth:complete.backToSignIn")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(address.hash).toBe("");
  });

  it("asks nothing of the server without a token", async () => {
    arriveAt("/auth/complete");
    const Complete = await page();
    render(<Complete />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect($fetch).not.toHaveBeenCalled();
  });
});

describe("finishing a desktop app sign-in in its window", () => {
  function enterDesktopApp(bridge: Record<string, unknown>) {
    Object.defineProperty(window, "__MARGAYA_DESKTOP__", {
      configurable: true,
      value: { version: "0.1.0", platform: "windows", ...bridge },
    });
  }

  it("sends the app's handoff secret with the token", async () => {
    const takeHandoffSecret = vi.fn(async () => "app-secret");
    enterDesktopApp({ takeHandoffSecret });
    $fetch.mockResolvedValue({
      data: { redirectTo: "/dashboard" },
      error: null,
    });
    arriveAt("/auth/complete#token=one-time-token");
    const Complete = await page();
    render(<Complete />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(takeHandoffSecret).toHaveBeenCalledOnce();
    expect($fetch).toHaveBeenCalledWith("/handoff/redeem", {
      method: "POST",
      body: { token: "one-time-token", desktopSecret: "app-secret" },
    });
  });

  it.each([
    ["has no such method", {}],
    ["has no secret", { takeHandoffSecret: async () => null }],
    [
      "fails to give one",
      {
        takeHandoffSecret: async () => {
          throw new Error("ipc");
        },
      },
    ],
  ])("sends the token alone when the app %s", async (_name, bridge) => {
    enterDesktopApp(bridge);
    $fetch.mockResolvedValue({
      data: { redirectTo: "/dashboard" },
      error: null,
    });
    arriveAt("/auth/complete#token=one-time-token");
    const Complete = await page();
    render(<Complete />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect($fetch).toHaveBeenCalledWith("/handoff/redeem", {
      method: "POST",
      body: { token: "one-time-token" },
    });
  });
});
