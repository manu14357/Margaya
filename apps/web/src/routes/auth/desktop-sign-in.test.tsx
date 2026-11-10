import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  signIn: { anonymous: vi.fn(), social: vi.fn(), oauth2: vi.fn() },
  fetch: vi.fn(),
  navigate: vi.fn(),
  config: {} as Record<string, unknown>,
  search: {} as Record<string, string>,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: m.signIn,
    $fetch: m.fetch,
    getLastUsedLoginMethod: () => null,
  },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useSearch: () => m.search,
  useNavigate: () => m.navigate,
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: m.config, isLoading: false }),
}));
vi.mock("@/hooks/queries/instance/use-instance-status", () => ({
  default: () => ({
    data: { hasUsers: true, hasAdmin: true },
    isLoading: false,
  }),
}));
vi.mock("@/components/auth/layout", () => ({
  AuthLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/auth/sign-up-form", () => ({ SignUpForm: () => null }));
vi.mock("@/components/auth/sign-in-form", () => ({
  SignInForm: ({ onSuccess }: { onSuccess: () => void }) => (
    <form aria-label="password sign-in">
      <button type="button" onClick={onSuccess}>
        password ok
      </button>
    </form>
  ),
}));
vi.mock("@/components/auth/toggle", () => ({ AuthToggle: () => null }));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { Route: signInRoute } = await import("./sign-in");
const { Route: signUpRoute } = await import("./sign-up");
const SignIn = signInRoute.options.component as ComponentType;
const SignUp = signUpRoute.options.component as ComponentType;

const startBrowserSignIn = vi.fn();
function enterDesktopApp(
  bridge: Record<string, unknown> = { startBrowserSignIn },
) {
  Object.defineProperty(window, "__MARGAYA_DESKTOP__", {
    configurable: true,
    value: { version: "0.1.0", platform: "windows", ...bridge },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.search = {};
  for (const mock of Object.values(m.signIn))
    mock.mockResolvedValue({ error: null });
  m.config = {
    hasGithubSignIn: true,
    hasCustomOAuth: true,
    hasSamlSignIn: true,
    hasGuestAccess: true,
  };
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "__MARGAYA_DESKTOP__");
});

describe("sign-in inside the desktop app", () => {
  it.each([
    "auth:signIn.continueWithGithub",
    "auth:signIn.continueWithOidc",
    "auth:signIn.continueWithSaml",
  ])("sends %s to the system browser", (label) => {
    enterDesktopApp();
    render(<SignIn />);
    expect(screen.getByText("auth:signIn.desktopBrowserHint")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(startBrowserSignIn).toHaveBeenCalledOnce();
    expect(m.signIn.social).not.toHaveBeenCalled();
    expect(m.signIn.oauth2).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
    // SAML asks for the address in the browser, not here.
    expect(screen.queryByLabelText("auth:signIn.samlEmail")).toBeNull();
    expect(screen.getByText("auth:signIn.desktopBrowserStarted")).toBeTruthy();
  });

  it("keeps password and guest sign-in in the window", async () => {
    enterDesktopApp();
    render(<SignIn />);
    expect(screen.getByRole("form", { name: "password sign-in" })).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "auth:signUp.continueAsGuest" }),
    );
    await waitFor(() => expect(m.signIn.anonymous).toHaveBeenCalledOnce());
    expect(startBrowserSignIn).not.toHaveBeenCalled();
  });

  it("does not open the browser by itself when OIDC signs in automatically", () => {
    m.config = { ...m.config, customOAuthAutoLogin: true };
    enterDesktopApp();
    render(<SignIn />);
    expect(startBrowserSignIn).not.toHaveBeenCalled();
    expect(m.signIn.oauth2).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "auth:signIn.continueWithOidc" }),
    ).toBeTruthy();
  });

  it("signs in here when the app has no browser sign-in", async () => {
    enterDesktopApp({});
    render(<SignIn />);
    expect(screen.queryByText("auth:signIn.desktopBrowserHint")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "auth:signIn.continueWithGithub" }),
    );
    await waitFor(() => expect(m.signIn.social).toHaveBeenCalledOnce());
  });

  it("routes sign-up's provider buttons to the browser too", () => {
    enterDesktopApp();
    render(<SignUp />);
    fireEvent.click(
      screen.getByRole("button", { name: "auth:signIn.continueWithGithub" }),
    );
    expect(startBrowserSignIn).toHaveBeenCalledOnce();
    expect(m.signIn.social).not.toHaveBeenCalled();
  });
});

describe("sign-in in a browser", () => {
  it("is unchanged: providers sign in here and nothing mentions the app", async () => {
    render(<SignIn />);
    expect(screen.queryByText("auth:signIn.desktopBrowserHint")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "auth:signIn.continueWithGithub" }),
    );
    await waitFor(() => expect(m.signIn.social).toHaveBeenCalledOnce());

    fireEvent.click(
      screen.getByRole("button", { name: "auth:signIn.continueWithSaml" }),
    );
    expect(screen.getByLabelText("auth:signIn.samlEmail")).toBeTruthy();
  });
});

describe("sign-in started by the desktop app's browser page", () => {
  it("returns to /desktop/authorize with its query intact", () => {
    const back =
      "/desktop/authorize?state=state-1234&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256";
    m.search = { redirect: back };
    render(<SignIn />);
    fireEvent.click(screen.getByRole("button", { name: "password ok" }));
    expect(m.navigate).toHaveBeenCalledWith({ href: back });
  });

  it("keeps other redirects as they were", () => {
    m.search = { redirect: "/dashboard/settings" };
    render(<SignIn />);
    fireEvent.click(screen.getByRole("button", { name: "password ok" }));
    expect(m.navigate).toHaveBeenCalledWith({ to: "/dashboard/settings" });
  });
});
