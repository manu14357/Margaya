import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./accept.$inviteId";

const navigate = vi.fn();
const useSession = vi.fn();
const useGetInvitationDetails = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => navigate,
  useParams: () => ({ inviteId: "invitation-1" }),
}));

vi.mock("@/hooks/queries/invitation/use-get-invitation-details", () => ({
  useGetInvitationDetails: (invitationId: string) =>
    useGetInvitationDetails(invitationId),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => useSession(),
  },
}));

// The real layout carries the guest language and theme menus, which pull in
// the full i18n runtime; this test only covers the invitation actions.
vi.mock("@/components/auth/layout", () => ({
  AuthLayout: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));

const AcceptInvitation = (Route as unknown as { component: ComponentType })
  .component;

function renderSignedOutInvitation() {
  useSession.mockReturnValue({ data: null, isPending: false });
  useGetInvitationDetails.mockReturnValue({
    data: {
      valid: true,
      invitation: {
        id: "invitation-1",
        email: "invitee@margaya.test",
        workspaceName: "Margaya",
        inviterName: "Ada",
        expiresAt: "2999-01-01T00:00:00.000Z",
        status: "pending",
        expired: false,
      },
    },
    isLoading: false,
    error: null,
  });

  render(<AcceptInvitation />);
}

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

describe("AcceptInvitation", () => {
  it("sends an invitee without an account to sign-up with the invitation", () => {
    renderSignedOutInvitation();

    fireEvent.click(
      screen.getByRole("button", { name: "auth:invitation.createAccount" }),
    );

    expect(navigate).toHaveBeenCalledWith({
      to: "/auth/sign-up",
      search: { invitationId: "invitation-1", email: "invitee@margaya.test" },
    });
  });

  it("keeps the sign-in route for invitees who already have an account", () => {
    renderSignedOutInvitation();

    fireEvent.click(
      screen.getByRole("button", { name: "auth:invitation.signIn" }),
    );

    expect(navigate).toHaveBeenCalledWith({
      to: "/auth/sign-in",
      search: { invitationId: "invitation-1", email: "invitee@margaya.test" },
    });
  });
});
