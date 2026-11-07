import { defaultRolePayloads } from "@margaya/permissions";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomRoleEditor, PermissionList } from "./roles";

const m = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/hooks/mutations/workspace/use-update-workspace-role", () => ({
  default: () => ({ mutateAsync: m.update, isPending: false }),
}));
vi.mock("@/hooks/mutations/workspace/use-create-workspace-role", () => ({
  default: () => ({}),
}));
vi.mock("@/hooks/mutations/workspace/use-delete-workspace-role", () => ({
  default: () => ({}),
}));
vi.mock("@/hooks/queries/workspace/use-workspace-roles", () => ({
  default: () => ({}),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({}),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  m.update.mockResolvedValue({ success: true });
});

// Better Auth's organization rights the editor shows (workspace, members,
// invitations and role administration).
const PROVIDER_RESOURCES = ["organization", "member", "invitation", "ac"];

// Each test renders the full permission vocabulary (~50 switches), which
// takes seconds in jsdom when the machine is busy.
describe("workspace role permission editing", { timeout: 120_000 }, () => {
  it("shows role administration, membership and invitations in read-only role details", () => {
    render(<PermissionList permissions={defaultRolePayloads.admin} readOnly />);
    for (const label of [
      "Change role permissions",
      "Change member roles",
      "Invite members",
    ]) {
      expect(screen.getByRole("switch", { name: label })).toBeChecked();
      expect(screen.getByRole("switch", { name: label })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
  });
  it("hides the rights of Teams, which are turned off", () => {
    expect(defaultRolePayloads.admin.team).toBeDefined();
    render(<PermissionList permissions={defaultRolePayloads.admin} readOnly />);
    expect(screen.queryByRole("switch", { name: "Edit teams" })).toBeNull();
    expect(screen.queryByText("Teams")).toBeNull();
  });
  it("can remove every permission, including all provider administrative rights", async () => {
    // The admin role's provider rights only: every switch click re-renders
    // the whole list synchronously (~0.4 s in jsdom), so clicking all of the
    // admin's ~50 rights took from 10 s to over 2 min on a busy machine and
    // overran the next test's timeout.
    const permission = Object.fromEntries(
      Object.entries(defaultRolePayloads.admin).filter(([resource]) =>
        PROVIDER_RESOURCES.includes(resource),
      ),
    );
    expect(Object.keys(permission).sort()).toEqual(
      [...PROVIDER_RESOURCES].sort(),
    );
    render(
      <CustomRoleEditor
        workspaceId="workspace"
        role={{
          id: "role",
          workspaceId: "workspace",
          role: "admin",
          permission,
          createdAt: new Date(),
        }}
        isDefault
        onDelete={() => {}}
      />,
    );
    const checked = screen.getAllByRole("switch", { checked: true });
    expect(checked).toHaveLength(Object.values(permission).flat().length);
    act(() => {
      for (const control of checked) control.click();
    });
    expect(screen.queryAllByRole("switch", { checked: true })).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workspaceRoles.saveChanges",
      }),
    );
    await waitFor(() =>
      expect(m.update).toHaveBeenCalledWith({
        workspaceId: "workspace",
        roleName: "admin",
        permission: {},
      }),
    );
  }, 30_000);
  it("also exposes unknown stored permission entries instead of silently retaining them", () => {
    render(
      <PermissionList
        permissions={{ extension: ["future-right"] }}
        selected={{ extension: new Set(["future-right"]) }}
        onToggle={() => {}}
      />,
    );
    expect(
      screen.getByRole("switch", { name: "future-right extension" }),
    ).toBeChecked();
  });
});
