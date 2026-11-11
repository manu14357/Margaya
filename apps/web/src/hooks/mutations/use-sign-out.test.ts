import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { atom, onMount } from "nanostores";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  atoms: {} as Record<string, unknown>,
  signOut: vi.fn(),
  navigate: vi.fn(async () => {}),
  releasePush: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth-client", () => ({
  AUTH_BASE_URL: "https://api.example.com/api/auth",
  authClient: {
    $store: { atoms: stores.atoms, notify: vi.fn() },
    signOut: stores.signOut,
  },
}));
vi.mock("@/fetchers/oauth/get-id-token", () => ({ getIdToken: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => stores.navigate,
}));
vi.mock(
  "@/hooks/mutations/notification-preferences/use-push-subscription",
  () => ({ releasePushOnSignOut: stores.releasePush }),
);

import useSignOut, { authStoresFetching } from "./use-sign-out";

function authStore(isRefetching: boolean) {
  const store = atom({ data: null, isRefetching });
  const mounted = vi.fn();
  onMount(store, () => {
    // A Better Auth query store fetches when it mounts.
    mounted();
  });
  return { store, mounted };
}

describe("authStoresFetching", () => {
  // Mounting a Better Auth store starts its request, which then raced the
  // sign-out into a 401.
  it("reads the organization stores without mounting them", () => {
    const idle = {
      activeOrganization: authStore(false),
      listOrganizations: authStore(false),
      activeMember: authStore(false),
      activeMemberRole: authStore(false),
    };
    for (const [name, { store }] of Object.entries(idle)) {
      stores.atoms[name] = store;
    }

    expect(authStoresFetching()).toBe(false);
    for (const { mounted } of Object.values(idle)) {
      expect(mounted).not.toHaveBeenCalled();
    }

    stores.atoms.activeMember = authStore(true).store;
    expect(authStoresFetching()).toBe(true);
  });
});

describe("closing the tab while signing out", () => {
  const beacon = vi.fn((_url: string, _body?: BodyInit) => true);

  beforeEach(() => {
    for (const name of Object.keys(stores.atoms)) {
      stores.atoms[name] = authStore(false).store;
    }
    beacon.mockClear();
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
    });
    stores.signOut.mockReset().mockResolvedValue({
      data: { success: true },
      error: null,
    });
    stores.releasePush.mockClear();
  });

  afterEach(cleanup);

  /** A request still on the wire holds the sign-out until it settles. */
  function signingOut() {
    const queryClient = new QueryClient();
    let settle = () => {};
    void queryClient.fetchQuery({
      queryKey: ["tasks"],
      queryFn: () =>
        new Promise((resolve) => {
          settle = () => resolve([]);
        }),
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useSignOut(), { wrapper });
    act(() => result.current.mutate());
    return { result, settle: () => settle() };
  }

  const pageGoes = () => window.dispatchEvent(new Event("pagehide"));

  it("ends the session even though the sign-out was still waiting", async () => {
    const { result, settle } = signingOut();
    await waitFor(() => expect(stores.navigate).toHaveBeenCalled());
    expect(stores.signOut).not.toHaveBeenCalled();

    pageGoes();
    expect(beacon).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/sign-out",
      expect.any(Blob),
    );
    // Better Auth refuses a body that isn't JSON (415).
    const [, body] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(body.type).toBe("application/json");
    expect(await body.text()).toBe("{}");
    // Push was released first, while the session was still valid.
    expect(stores.releasePush).toHaveBeenCalled();

    settle();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("releases push before anything else, even before fetching the id token", async () => {
    const { getIdToken } = await import("@/fetchers/oauth/get-id-token");
    // The id token request is still on the wire when the tab closes.
    let answer: (value: never) => void = () => {};
    vi.mocked(getIdToken).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(
      () => useSignOut("https://idp.example.com/logout"),
      { wrapper },
    );
    act(() => result.current.mutate());
    await waitFor(() => expect(getIdToken).toHaveBeenCalled());
    expect(stores.releasePush).toHaveBeenCalled();

    // Let it finish without leaving for the identity provider: a refused
    // sign-out stays on the page.
    stores.signOut.mockResolvedValueOnce({
      data: null,
      error: { message: "refused" },
    });
    answer({ idToken: null } as never);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("signs the desktop app out too, once the session has ended", async () => {
    const signedOut = vi.fn(() => {
      // The web session ends first; the app follows.
      expect(stores.signOut).toHaveBeenCalled();
    });
    Object.defineProperty(window, "__MARGAYA_DESKTOP__", {
      configurable: true,
      value: { signedOut },
    });
    try {
      const { result, settle } = signingOut();
      settle();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(signedOut).toHaveBeenCalledOnce();
    } finally {
      Reflect.deleteProperty(window, "__MARGAYA_DESKTOP__");
    }
  });

  it("keeps the desktop app signed in when the sign-out is refused", async () => {
    const signedOut = vi.fn();
    Object.defineProperty(window, "__MARGAYA_DESKTOP__", {
      configurable: true,
      value: { signedOut },
    });
    stores.signOut.mockResolvedValueOnce({
      data: null,
      error: { message: "refused" },
    });
    try {
      const { result, settle } = signingOut();
      settle();
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(signedOut).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(window, "__MARGAYA_DESKTOP__");
    }
  });

  it("sends nothing extra once the sign-out has been done", async () => {
    const { result, settle } = signingOut();
    settle();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stores.signOut).toHaveBeenCalledTimes(1);

    pageGoes();
    expect(beacon).not.toHaveBeenCalled();
  });
});
