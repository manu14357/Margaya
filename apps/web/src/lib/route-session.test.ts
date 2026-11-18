import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: undefined as unknown,
  getSession: vi.fn(),
  signingOut: false,
}));

vi.mock("./auth-client", () => ({
  authClient: {
    getSession: mocks.getSession,
    $store: {
      atoms: {
        session: {
          get value() {
            return mocks.state;
          },
        },
      },
    },
  },
}));

vi.mock("./sign-out", () => ({ isSigningOut: () => mocks.signingOut }));

const { heldSession, routeSession } = await import("./route-session");

function signedIn(expiresInMs = 60_000) {
  return {
    session: {
      id: "session-1",
      activeOrganizationId: "workspace-1",
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    },
    user: { id: "user-1", twoFactorEnabled: false },
  };
}

describe("routeSession", () => {
  afterEach(() => {
    mocks.state = undefined;
    mocks.signingOut = false;
    mocks.getSession.mockReset();
  });

  it("reuses the session the auth store holds without a request", async () => {
    const data = signedIn();
    mocks.state = { data, error: null, isPending: false };

    await expect(routeSession()).resolves.toBe(data);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("asks the server when the store holds no session", async () => {
    mocks.state = { data: null, error: null, isPending: false };
    mocks.getSession.mockResolvedValue({ data: null });

    await expect(routeSession()).resolves.toBeNull();
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
  });

  it("asks the server while the store is still loading or after an error", async () => {
    const fresh = signedIn();
    mocks.getSession.mockResolvedValue({ data: fresh });

    mocks.state = { data: null, error: null, isPending: true };
    await expect(routeSession()).resolves.toBe(fresh);

    mocks.state = { data: signedIn(), error: new Error("x"), isPending: false };
    await expect(routeSession()).resolves.toBe(fresh);
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
  });

  it("does not trust an expired session or one held during a sign-out", () => {
    mocks.state = { data: signedIn(-1000), error: null, isPending: false };
    expect(heldSession()).toBeNull();

    mocks.state = { data: signedIn(), error: null, isPending: false };
    mocks.signingOut = true;
    expect(heldSession()).toBeNull();
  });
});
