import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  authorize: vi.fn(),
  copy: vi.fn(),
  session: { data: null as unknown, isPending: false },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => m.navigate,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => m.session },
}));
vi.mock("@/fetchers/desktop/authorize-desktop-sign-in", () => ({
  default: m.authorize,
}));
vi.mock("@/lib/copy-to-clipboard", () => ({ copyToClipboard: m.copy }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/auth/layout", () => ({
  AuthLayout: ({ title, children }: { title: string; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

const { Route } = await import("./desktop.authorize");
const Page = Route.options.component as ComponentType;

const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const QUERY = `?state=state-1234&code_challenge=${CHALLENGE}&code_challenge_method=S256`;
const REQUEST = {
  state: "state-1234",
  code_challenge: CHALLENGE,
  code_challenge_method: "S256",
};
const CALLBACK =
  "com.margaya.desktop://auth/callback?code=c0de&state=state-1234";
let opened: string[];

function arrive(search: string) {
  opened = [];
  vi.stubGlobal("location", {
    search,
    host: "margaya.example.com",
    set href(value: string) {
      opened.push(value);
    },
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Page />
    </QueryClientProvider>,
  );
}

const allow = () =>
  fireEvent.click(screen.getByRole("button", { name: "auth:desktop.allow" }));

beforeEach(() => {
  vi.clearAllMocks();
  m.session = {
    data: { user: { name: "Pat", email: "pat@example.com" } },
    isPending: false,
  };
  arrive(QUERY);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/desktop/authorize", () => {
  it("refuses a malformed request without asking anything", () => {
    arrive("?state=x&code_challenge_method=plain");
    renderPage();
    expect(screen.getByText("auth:desktop.invalidTitle")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("sends a signed-out visitor to sign in and back here", () => {
    m.session = { data: null, isPending: false };
    arrive(`${QUERY}&display=code`);
    renderPage();
    expect(m.navigate).toHaveBeenCalledWith({
      to: "/auth/sign-in",
      search: { redirect: `/desktop/authorize${QUERY}&display=code` },
      replace: true,
    });
  });

  it("asks before signing the app in, and opens the app on Allow", async () => {
    m.authorize.mockResolvedValue({ code: "c0de", redirectTo: CALLBACK });
    renderPage();
    expect(
      screen.getByText(
        `auth:desktop.confirm:${JSON.stringify({ account: "Pat (pat@example.com)", server: "margaya.example.com" })}`,
      ),
    ).toBeTruthy();
    expect(screen.getByText("auth:desktop.warning")).toBeTruthy();
    expect(m.authorize).not.toHaveBeenCalled();

    allow();
    await waitFor(() => expect(opened).toEqual([CALLBACK]));
    expect(m.authorize.mock.calls[0]?.[0]).toEqual(REQUEST);
    expect(await screen.findByText("auth:desktop.doneTitle")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "auth:desktop.openAgain" }),
    ).toHaveAttribute("href", CALLBACK);
  });

  it("never opens anything but the desktop app", async () => {
    m.authorize.mockResolvedValue({
      code: "c0de",
      redirectTo: "https://evil.example/",
    });
    renderPage();
    allow();
    expect(await screen.findByText("auth:desktop.failed")).toBeTruthy();
    expect(opened).toEqual([]);
  });

  it("shows the code to paste with display=code", async () => {
    arrive(`${QUERY}&display=code`);
    m.authorize.mockResolvedValue({ code: "c0de", redirectTo: CALLBACK });
    m.copy.mockResolvedValue(true);
    renderPage();
    allow();

    expect(await screen.findByText("c0de")).toBeTruthy();
    expect(opened).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "auth:desktop.copy" }));
    await waitFor(() => expect(m.copy).toHaveBeenCalledWith("c0de"));
  });

  it("cancels without asking the server", () => {
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: "auth:desktop.cancel" }),
    );
    expect(screen.getByText("auth:desktop.cancelledTitle")).toBeTruthy();
    expect(m.authorize).not.toHaveBeenCalled();
  });

  it.each([
    [400, "auth:desktop.expired"],
    [404, "auth:desktop.disabled"],
    [429, "auth:desktop.rateLimited"],
    [500, "auth:desktop.failed"],
  ])("explains a %s and offers to try again", async (status, key) => {
    m.authorize.mockRejectedValue(new HttpError(status, "no"));
    renderPage();
    allow();
    expect(await screen.findByText(key)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "auth:desktop.tryAgain" }),
    ).toBeTruthy();
    expect(opened).toEqual([]);
  });
});
