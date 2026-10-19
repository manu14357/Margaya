import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkspaceUser,
  WorkspaceUserInvitation,
} from "@/types/workspace-user";
import MembersTable from "./members-table";

const copyToClipboard = vi.fn();
const success = vi.fn();
const error = vi.fn();

vi.mock("@/lib/copy-to-clipboard", () => ({
  copyToClipboard: (text: string) => copyToClipboard(text),
}));

vi.mock("@/hooks/queries/ai/use-agents", () => ({
  useAgentUserIds: () => new Set<string>(),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (msg: string) => success(msg),
    error: (msg: string) => error(msg),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/format", () => ({
  formatDateMedium: () => "Sep 1, 2026",
}));

vi.mock("@/hooks/mutations/workspace-user/use-cancel-invitation", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/mutations/workspace-user/use-delete-workspace-user", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock(
  "@/hooks/mutations/workspace-user/use-update-workspace-user-role",
  () => ({
    default: () => ({ mutateAsync: vi.fn() }),
  }),
);

vi.mock("@/hooks/queries/workspace/use-workspace-roles", () => ({
  default: () => ({ data: [] }),
}));

const updateInvitationRole = vi.fn();
vi.mock("@/hooks/mutations/workspace-user/use-update-invitation-role", () => ({
  default: () => ({ mutateAsync: updateInvitationRole }),
}));

const grantable = vi.fn(() => ["viewer", "member", "admin"]);
vi.mock("@/hooks/queries/workspace/use-grantable-roles", () => ({
  default: () => ({ roles: grantable(), isLoading: false }),
}));

const canInviteUsers = vi.fn(() => true);
const canManageInvitations = vi.fn(() => true);

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageTeam: () => true,
    canRemoveMembers: () => true,
    canInviteUsers: () => canInviteUsers(),
    canManageInvitations: () => canManageInvitations(),
    role: "admin",
  }),
}));

vi.mock("../providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "current-user" } }),
}));

beforeEach(() => {
  canInviteUsers.mockReturnValue(true);
  canManageInvitations.mockReturnValue(true);
  grantable.mockReturnValue(["viewer", "member", "admin"]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const pendingInvitation = {
  id: "invite-1",
  email: "invitee@example.com",
  role: "member",
  status: "pending",
  expiresAt: "2026-09-01T00:00:00.000Z",
} as unknown as WorkspaceUserInvitation;

describe("MembersTable pending invitation row menu", () => {
  it("copies the invitation link for that invitation when 'Copy link' is clicked", async () => {
    copyToClipboard.mockResolvedValue(true);

    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaInvitationActions",
      }),
    );

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:invitations.copyLink",
      }),
    );

    expect(copyToClipboard).toHaveBeenCalledWith(
      `${window.location.origin}/invitation/accept/invite-1`,
    );
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("team:invitations.linkCopied"),
    );
  });

  it("still opens the cancel confirmation dialog instead of cancelling directly", async () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaInvitationActions",
      }),
    );

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:membersTable.cancelInvitation",
      }),
    );

    expect(
      await screen.findByText("team:membersTable.cancelDialogTitle"),
    ).toBeVisible();
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("hides the row menu entirely when the user lacks canInvite", () => {
    canInviteUsers.mockReturnValue(false);

    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );

    expect(
      screen.queryByRole("button", {
        name: "team:membersTable.ariaInvitationActions",
      }),
    ).toBeNull();
  });
});

describe("MembersTable pending invitation role", () => {
  const roleSelect = () =>
    screen.getByRole("combobox", {
      name: "team:membersTable.ariaInvitationRole",
    });

  it("changes a pending invitation's role to another grantable role", async () => {
    updateInvitationRole.mockResolvedValue({});
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );

    fireEvent.click(roleSelect());
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "team:roles.viewer",
      "team:roles.member",
      "team:roles.admin",
    ]);
    const viewer = await screen.findByRole("option", {
      name: "team:roles.viewer",
    });
    fireEvent.pointerDown(viewer, { pointerType: "mouse" });
    fireEvent.click(viewer);

    await waitFor(() =>
      expect(updateInvitationRole).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        invitationId: "invite-1",
        role: "viewer",
      }),
    );
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        "team:membersTable.invitationRoleUpdateSuccess",
      ),
    );
  });

  it("shows the role read-only when it is above the viewer's own", () => {
    grantable.mockReturnValue(["viewer", "member"]);
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[
          { ...pendingInvitation, role: "admin" } as WorkspaceUserInvitation,
        ]}
        users={[] as WorkspaceUser[]}
      />,
    );
    expect(
      screen.queryByRole("combobox", {
        name: "team:membersTable.ariaInvitationRole",
      }),
    ).toBeNull();
    expect(screen.getByText("team:roles.admin")).toBeVisible();
  });

  it("shows the role read-only without permission to manage invitations", () => {
    canManageInvitations.mockReturnValue(false);
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );
    expect(
      screen.queryByRole("combobox", {
        name: "team:membersTable.ariaInvitationRole",
      }),
    ).toBeNull();
  });
});
