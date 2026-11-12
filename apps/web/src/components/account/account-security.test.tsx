import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveSessionsSection } from "./active-sessions-section";
import { ChangePasswordSection } from "./change-password-section";
import { EmailVerificationPrompt } from "./email-verification-prompt";

const m = vi.hoisted(() => ({
  changePassword: vi.fn(),
  revokeOtherSessions: vi.fn(),
  sendVerificationOtp: vi.fn(),
  verifyEmail: vi.fn(),
  revokeSession: vi.fn(),
  refetchUser: vi.fn(),
  user: {
    id: "user-1",
    email: "me@example.com",
    emailVerified: false,
  } as Record<string, unknown> | null,
  hasSmtp: true,
  toastError: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: m.toastError },
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    changePassword: m.changePassword,
    revokeOtherSessions: m.revokeOtherSessions,
    emailOtp: {
      sendVerificationOtp: m.sendVerificationOtp,
      verifyEmail: m.verifyEmail,
    },
  },
}));
vi.mock("@/fetchers/user/revoke-session", () => ({
  default: m.revokeSession,
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: m.user, refetchUser: m.refetchUser }),
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: { hasSmtp: m.hasSmtp } }),
}));

let queryClient: QueryClient;

function renderWithQuery(ui: ReactNode) {
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient = new QueryClient();
  m.user = { id: "user-1", email: "me@example.com", emailVerified: false };
  m.hasSmtp = true;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChangePasswordSection", () => {
  function fill(current: string, next: string, confirm: string) {
    fireEvent.change(
      screen.getByLabelText("settings:securityPage.password.current"),
      { target: { value: current } },
    );
    fireEvent.change(
      screen.getByLabelText("settings:securityPage.password.new"),
      { target: { value: next } },
    );
    fireEvent.change(
      screen.getByLabelText("settings:securityPage.password.confirm"),
      { target: { value: confirm } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:securityPage.password.submit",
      }),
    );
  }

  it("signs out other sessions by default", async () => {
    m.changePassword.mockResolvedValue({ data: {}, error: null });
    renderWithQuery(<ChangePasswordSection />);

    expect(
      screen.getByRole("checkbox", {
        name: /settings:securityPage.password.signOutOthers/,
      }),
    ).toBeChecked();
    fill("old passphrase", "a long new passphrase", "a long new passphrase");

    await waitFor(() =>
      expect(m.changePassword).toHaveBeenCalledWith({
        currentPassword: "old passphrase",
        newPassword: "a long new passphrase",
        revokeOtherSessions: true,
      }),
    );
  });

  it("shows a wrong current password on its field", async () => {
    m.changePassword.mockResolvedValue({
      data: null,
      error: { code: "INVALID_PASSWORD", message: "Invalid password" },
    });
    renderWithQuery(<ChangePasswordSection />);

    fill("not it", "a long new passphrase", "a long new passphrase");

    expect(
      await screen.findByText("settings:securityPage.password.wrongCurrent"),
    ).toBeInTheDocument();
    expect(m.toastError).not.toHaveBeenCalled();
  });

  it("checks the confirmation before sending", async () => {
    renderWithQuery(<ChangePasswordSection />);
    fill("old passphrase", "a long new passphrase", "something else");
    expect(
      await screen.findByText("auth:forms.passwordsDoNotMatch"),
    ).toBeInTheDocument();
    expect(m.changePassword).not.toHaveBeenCalled();
  });
});

describe("ActiveSessionsSection", () => {
  const sessions = [
    {
      id: "session-current",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      ipAddress: "203.0.113.4",
      createdAt: "2026-10-01T10:00:00.000Z",
      lastActiveAt: "2026-10-13T10:00:00.000Z",
      expiresAt: "2026-10-20T10:00:00.000Z",
      current: true,
    },
    {
      id: "session-phone",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ipAddress: null,
      createdAt: "2026-10-02T10:00:00.000Z",
      lastActiveAt: "2026-10-12T10:00:00.000Z",
      expiresAt: "2026-10-19T10:00:00.000Z",
      current: false,
    },
  ];

  it("marks this device and offers sign-out only for the others", async () => {
    m.revokeSession.mockResolvedValue({ revoked: true });
    renderWithQuery(
      <ActiveSessionsSection
        sessions={sessions}
        isLoading={false}
        isError={false}
      />,
    );

    expect(
      screen.getByText("settings:securityPage.sessions.thisDevice"),
    ).toBeInTheDocument();
    const signOutButtons = screen.getAllByRole("button", {
      name: "settings:securityPage.sessions.signOutAria",
    });
    expect(signOutButtons).toHaveLength(1);

    fireEvent.click(signOutButtons[0]);
    await waitFor(() =>
      expect(m.revokeSession).toHaveBeenCalledWith("session-phone"),
    );
    expect(
      screen.getByRole("button", {
        name: "settings:securityPage.sessions.signOutOthers",
      }),
    ).toBeInTheDocument();
  });

  it("hides sign-out-all when this is the only session", () => {
    renderWithQuery(
      <ActiveSessionsSection
        sessions={[sessions[0]]}
        isLoading={false}
        isError={false}
      />,
    );
    expect(
      screen.queryByRole("button", {
        name: "settings:securityPage.sessions.signOutOthers",
      }),
    ).toBeNull();
  });

  it("lists this device first and folds a long list", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...sessions[1],
      id: `session-${index}`,
      userAgent: index === 7 ? "MargayaDesktop/0.1.0" : sessions[1].userAgent,
      lastActiveAt: `2026-10-${String(10 + index).padStart(2, "0")}T10:00:00.000Z`,
    }));
    renderWithQuery(
      <ActiveSessionsSection
        sessions={[...many, sessions[0]]}
        isLoading={false}
        isError={false}
      />,
    );

    const rows = () => document.querySelectorAll('[data-slot="settings-row"]');
    expect(rows()).toHaveLength(5);
    expect(rows()[0]).toHaveTextContent(
      "settings:securityPage.sessions.thisDevice",
    );
    // The most recent other session is the desktop app's own sign-in.
    expect(rows()[1]).toHaveTextContent(
      "settings:securityPage.sessions.desktopApp",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:securityPage.sessions.showAll",
      }),
    );
    expect(rows()).toHaveLength(9);
    expect(
      screen.getByRole("button", {
        name: "settings:securityPage.sessions.showFewer",
      }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("says so when the sessions can't load", () => {
    renderWithQuery(
      <ActiveSessionsSection sessions={undefined} isLoading={false} isError />,
    );
    expect(
      screen.getByText("settings:securityPage.sessions.loadError"),
    ).toBeInTheDocument();
  });
});

describe("EmailVerificationPrompt", () => {
  it("sends a code, verifies it and refreshes the invitations", async () => {
    m.sendVerificationOtp.mockResolvedValue({ data: {}, error: null });
    m.verifyEmail.mockResolvedValue({ data: {}, error: null });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    renderWithQuery(<EmailVerificationPrompt variant="invitations" />);

    expect(
      screen.getByText("auth:emailVerification.invitationsDescription"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "auth:emailVerification.sendCode" }),
    );
    await waitFor(() =>
      expect(m.sendVerificationOtp).toHaveBeenCalledWith({
        email: "me@example.com",
        type: "email-verification",
      }),
    );

    fireEvent.change(
      await screen.findByLabelText("auth:emailVerification.codeLabel"),
      { target: { value: "12a3456" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "auth:emailVerification.verify" }),
    );

    await waitFor(() =>
      expect(m.verifyEmail).toHaveBeenCalledWith({
        email: "me@example.com",
        otp: "123456",
      }),
    );
    await waitFor(() => expect(m.refetchUser).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["invitations", "pending"],
    });
  });

  it("stays hidden without SMTP, for verified users and for guests", () => {
    m.hasSmtp = false;
    const { rerender } = renderWithQuery(
      <EmailVerificationPrompt variant="invitations" />,
    );
    expect(screen.queryByText("auth:emailVerification.title")).toBeNull();

    m.hasSmtp = true;
    m.user = { id: "user-1", email: "me@example.com", emailVerified: true };
    rerender(
      <QueryClientProvider client={queryClient}>
        <EmailVerificationPrompt variant="invitations" />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("auth:emailVerification.title")).toBeNull();

    m.user = {
      id: "guest",
      email: "guest@margaya.app",
      emailVerified: false,
      isAnonymous: true,
    };
    rerender(
      <QueryClientProvider client={queryClient}>
        <EmailVerificationPrompt variant="invitations" />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("auth:emailVerification.title")).toBeNull();
  });
});
