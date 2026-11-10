import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ session: null as unknown }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  redirect: (options: unknown) => ({ redirect: options }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { getSession: async () => ({ data: m.session }) },
}));
vi.mock("@/lib/sign-out", () => ({ isSigningOut: () => false }));

const { Route } = await import("./auth");
const beforeLoad = (
  Route as unknown as {
    options: {
      beforeLoad: (context: {
        location: { search: Record<string, unknown> };
      }) => Promise<unknown>;
    };
  }
).options.beforeLoad;

const BACK =
  "/desktop/authorize?state=state-1234&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256";

afterEach(() => {
  m.session = null;
});

describe("/auth for a signed-in visitor", () => {
  it("returns a desktop app sign-in to its authorize page", async () => {
    m.session = { user: { id: "u1" } };
    await expect(
      beforeLoad({ location: { search: { redirect: BACK } } }),
    ).rejects.toEqual({ redirect: { href: BACK } });
  });

  it.each([
    {},
    { redirect: "/dashboard/settings" },
    { redirect: "//evil.example/desktop/authorize" },
  ])("still goes to the dashboard for %o", async (search) => {
    m.session = { user: { id: "u1" } };
    await expect(beforeLoad({ location: { search } })).rejects.toEqual({
      redirect: { to: "/dashboard" },
    });
  });

  it("lets a signed-out visitor through", async () => {
    await expect(
      beforeLoad({ location: { search: { redirect: BACK } } }),
    ).resolves.toEqual({ session: null });
  });
});
