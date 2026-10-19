import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import InviteTeamMemberModal from "./invite-team-member-modal";

const mocks = vi.hoisted(() => ({
  invite: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  roles: ["viewer", "member"],
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.emails ? `${key}:${options.emails}` : key,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));
vi.mock("@/hooks/mutations/workspace-user/use-invite-workspace-user", () => ({
  default: () => ({ mutateAsync: mocks.invite }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));
vi.mock("@/hooks/queries/workspace/use-grantable-roles", () => ({
  default: () => ({ roles: mocks.roles, isLoading: false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canInviteUsers: () => true,
    role: "member",
  }),
}));
vi.mock("./invitation-link-field", () => ({
  default: ({ invitationId }: { invitationId: string }) => (
    <output>{`link:${invitationId}`}</output>
  ),
}));

beforeEach(() => {
  mocks.roles = ["viewer", "member"];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderModal() {
  const onClose = vi.fn();
  render(<InviteTeamMemberModal open onClose={onClose} />);
  return { onClose };
}

const emailBox = () =>
  screen.getByRole("textbox", { name: "team:inviteModal.emailLabel" });
const roleSelect = () =>
  screen.getByRole("combobox", { name: "team:inviteModal.roleLabel" });
const submit = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "team:inviteModal.sendInvitation" }),
  );

describe("InviteTeamMemberModal", () => {
  it("offers only the roles the inviter may grant, defaulting to member", async () => {
    renderModal();
    expect(roleSelect()).toHaveTextContent("team:roles.member");
    fireEvent.click(roleSelect());
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "team:roles.viewer",
      "team:roles.member",
    ]);
  });

  it("refuses invalid addresses inline without sending anything", async () => {
    renderModal();
    fireEvent.change(emailBox(), { target: { value: "a@x.io, nope" } });
    submit();
    expect(
      await screen.findByText("team:inviteModal.invalidEmails:nope"),
    ).toBeVisible();
    expect(emailBox()).toHaveAttribute("aria-invalid", "true");
    expect(mocks.invite).not.toHaveBeenCalled();
  });

  it("sends several invitations in order with the chosen role and shows each link", async () => {
    mocks.invite.mockImplementation(async ({ email }: { email: string }) => ({
      id: `id-${email}`,
    }));
    renderModal();
    fireEvent.click(roleSelect());
    const viewer = await screen.findByRole("option", {
      name: "team:roles.viewer",
    });
    fireEvent.pointerDown(viewer, { pointerType: "mouse" });
    fireEvent.click(viewer);
    await waitFor(() =>
      expect(roleSelect()).toHaveTextContent("team:roles.viewer"),
    );

    fireEvent.change(emailBox(), {
      target: { value: "a@x.io\nb@x.io" },
    });
    submit();

    expect(await screen.findByText("link:id-a@x.io")).toBeVisible();
    expect(screen.getByText("link:id-b@x.io")).toBeVisible();
    expect(mocks.invite.mock.calls.map(([call]) => call)).toEqual([
      { email: "a@x.io", workspaceId: "ws-1", role: "viewer" },
      { email: "b@x.io", workspaceId: "ws-1", role: "viewer" },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "team:inviteModal.success",
    );
  });

  it("keeps failed addresses in the box and lists why each failed", async () => {
    mocks.invite.mockImplementation(async ({ email }: { email: string }) => {
      if (email === "b@x.io") throw new Error("User is already invited");
      if (email === "c@x.io") throw new HttpError(429, "Too many requests");
      return { id: `id-${email}` };
    });
    renderModal();
    fireEvent.change(emailBox(), {
      target: { value: "a@x.io b@x.io c@x.io d@x.io" },
    });
    submit();

    expect(
      await screen.findByText("team:inviteModal.failedTitle"),
    ).toBeVisible();
    expect(screen.getByText(/User is already invited/)).toBeVisible();
    expect(screen.getAllByText(/team:inviteModal.rateLimited/)).toHaveLength(2);
    expect(emailBox()).toHaveValue("b@x.io\nc@x.io\nd@x.io");
    // The batch stops at the rate limit instead of hammering the API.
    expect(mocks.invite).toHaveBeenCalledTimes(3);
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "team:inviteModal.sentSome",
    );
  });
});
