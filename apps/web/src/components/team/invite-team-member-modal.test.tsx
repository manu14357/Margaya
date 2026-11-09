import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { InvitationProjectsError } from "@/lib/invite-emails";
import InviteTeamMemberModal from "./invite-team-member-modal";

const mocks = vi.hoisted(() => ({
  invite: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  roles: ["viewer", "member"],
  canShare: true,
  projects: [
    { id: "p-shared", name: "Website", archivedAt: null, leadUserId: null },
    { id: "p-led", name: "Launch", archivedAt: null, leadUserId: "me" },
    { id: "p-old", name: "Old", archivedAt: "2026-01-01", leadUserId: null },
  ],
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.emails
        ? `${key}:${options.emails}`
        : options?.project || options?.message
          ? `${key}:${options.project ?? options.message}`
          : key,
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
    canShareProjects: () => mocks.canShare,
    role: "member",
  }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: mocks.projects, isLoading: false }),
}));
vi.mock("@/hooks/queries/workspace/use-workspace-roles", () => ({
  default: () => ({ data: [] }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "me" } }),
}));
vi.mock("./invitation-link-field", () => ({
  default: ({ invitationId }: { invitationId: string }) => (
    <output>{`link:${invitationId}`}</output>
  ),
}));

beforeEach(() => {
  mocks.roles = ["viewer", "member"];
  mocks.canShare = true;
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

  async function pickRole(name: string) {
    fireEvent.click(roleSelect());
    const option = await screen.findByRole("option", { name });
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.click(option);
    await waitFor(() => expect(roleSelect()).toHaveTextContent(name));
  }

  it("asks for a guest's projects and sends them with each invitation", async () => {
    mocks.roles = ["viewer", "member", "guest"];
    mocks.invite.mockImplementation(async ({ email }: { email: string }) => ({
      id: `id-${email}`,
    }));
    renderModal();
    expect(
      screen.queryByRole("group", {
        name: "team:inviteModal.guestProjectsLabel",
      }),
    ).toBeNull();

    // Guest is offered by name (not a translated built-in here).
    await pickRole("Guest");
    const picker = screen.getByRole("group", {
      name: "team:inviteModal.guestProjectsLabel",
    });
    // Archived projects aren't offered.
    expect(picker).toHaveTextContent("Website");
    expect(picker).not.toHaveTextContent("Old");

    fireEvent.click(screen.getByRole("checkbox", { name: "Website" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Launch" }));
    const launchRole = screen.getByRole("combobox", {
      name: "team:inviteModal.guestProjectRoleFor:Launch",
    });
    expect(launchRole).toHaveTextContent("team:roles.viewer");
    fireEvent.click(launchRole);
    const member = await screen.findByRole("option", {
      name: "team:roles.member",
    });
    fireEvent.pointerDown(member, { pointerType: "mouse" });
    fireEvent.click(member);
    await waitFor(() =>
      expect(launchRole).toHaveTextContent("team:roles.member"),
    );

    fireEvent.change(emailBox(), { target: { value: "g@x.io" } });
    submit();
    expect(await screen.findByText("link:id-g@x.io")).toBeVisible();
    expect(mocks.invite).toHaveBeenCalledWith({
      email: "g@x.io",
      workspaceId: "ws-1",
      role: "guest",
      projects: [
        { projectId: "p-shared", role: "viewer" },
        { projectId: "p-led", role: "member" },
      ],
    });
  });

  it("offers only the projects the inviter leads without project:share", async () => {
    mocks.roles = ["guest"];
    mocks.canShare = false;
    renderModal();
    await waitFor(() => expect(roleSelect()).toHaveTextContent("Guest"));
    expect(screen.queryByRole("checkbox", { name: "Website" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Launch" })).toBeVisible();
  });

  it("says so when the invitation went out but its projects were refused", async () => {
    mocks.roles = ["guest"];
    mocks.invite.mockRejectedValue(
      new InvitationProjectsError("Adding someone needs project:share"),
    );
    renderModal();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Website" }));
    fireEvent.change(emailBox(), { target: { value: "g@x.io" } });
    submit();
    expect(
      await screen.findByText(
        /team:inviteModal\.guestProjectsFailed:Adding someone needs project:share/,
      ),
    ).toBeVisible();
  });
});
