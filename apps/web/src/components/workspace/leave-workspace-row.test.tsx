import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeaveWorkspaceRow } from "./leave-workspace-row";

const m = vi.hoisted(() => ({
  leave: vi.fn(),
  navigate: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => m.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.toastSuccess, error: m.toastError },
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { organization: { leave: m.leave } },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderRow(members: Array<{ userId: string; role: string }>) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LeaveWorkspaceRow
        workspaceId="workspace-1"
        workspaceName="Acme"
        currentUserId="me"
        members={members}
      />
    </QueryClientProvider>,
  );
}

describe("LeaveWorkspaceRow", () => {
  it("confirms, leaves and returns to the dashboard", async () => {
    m.leave.mockResolvedValue({ data: {}, error: null });
    renderRow([
      { userId: "owner", role: "owner" },
      { userId: "me", role: "member" },
    ]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workspaceGeneral.leave.confirm",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "settings:workspaceGeneral.leave.confirm",
      }),
    );

    await waitFor(() =>
      expect(m.leave).toHaveBeenCalledWith({ organizationId: "workspace-1" }),
    );
    await waitFor(() =>
      expect(m.navigate).toHaveBeenCalledWith({ to: "/dashboard" }),
    );
  });

  it("explains why the last owner cannot leave", () => {
    renderRow([
      { userId: "me", role: "owner" },
      { userId: "someone", role: "member" },
    ]);

    expect(
      screen.getByText("settings:workspaceGeneral.leave.lastOwner"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "settings:workspaceGeneral.leave.confirm",
      }),
    ).toBeDisabled();
  });

  it("lets an owner leave when another owner remains", () => {
    renderRow([
      { userId: "me", role: "owner" },
      { userId: "co-owner", role: "owner" },
    ]);
    expect(
      screen.getByRole("button", {
        name: "settings:workspaceGeneral.leave.confirm",
      }),
    ).toBeEnabled();
  });

  it("shows the server's last-owner refusal clearly", async () => {
    m.leave.mockResolvedValue({
      data: null,
      error: {
        code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
        message: "You cannot leave the organization as the only owner",
      },
    });
    renderRow([]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workspaceGeneral.leave.confirm",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "settings:workspaceGeneral.leave.confirm",
      }),
    );

    await waitFor(() =>
      expect(m.toastError).toHaveBeenCalledWith(
        "settings:workspaceGeneral.leave.lastOwner",
      ),
    );
    expect(m.navigate).not.toHaveBeenCalled();
  });
});
