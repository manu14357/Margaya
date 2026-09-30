import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ModuleRowActions from "./module-row-actions";
import { makeModule } from "./test-fixtures";

const permissions = vi.hoisted(() => ({
  canUpdateModules: true,
  canReadAnalytics: false,
  navigate: vi.fn(),
  canDeleteModules: false,
  userId: "someone",
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => permissions.navigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateModules: () => permissions.canUpdateModules,
    canReadAnalytics: () => permissions.canReadAnalytics,
    canDeleteModules: () => permissions.canDeleteModules,
    isCheckingPermissions: false,
  }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: permissions.userId } } }),
  },
}));

vi.mock("@/hooks/mutations/module/use-archive-module", () => ({
  useArchiveModule: () => ({ mutate: vi.fn() }),
}));

vi.mock("./module-form-dialog", () => ({ default: () => null }));
vi.mock("./archive-module-dialog", () => ({ default: () => null }));
vi.mock("./delete-module-dialog", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  permissions.canUpdateModules = true;
  permissions.canReadAnalytics = false;
  permissions.navigate.mockReset();
  permissions.canDeleteModules = false;
  permissions.userId = "someone";
});

async function openMenu(module = makeModule()) {
  render(<ModuleRowActions module={module} workspaceId="ws-1" />);
  fireEvent.click(screen.getByRole("button", { name: "modules:actions.menu" }));
  await screen.findByRole("menuitem", { name: /modules:actions.copyLink/ });
  return screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
}

describe("ModuleRowActions", () => {
  it("disables archive with a hint while the module is in progress", async () => {
    permissions.canDeleteModules = true;
    const items = await openMenu(makeModule({ status: "in-progress" }));
    expect(items).toEqual([
      "modules:actions.edit",
      "modules:actions.copyLink",
      "modules:actions.archivemodules:actions.archiveDisabledHint",
      "modules:actions.delete",
    ]);
    expect(
      screen.getByRole("menuitem", { name: /modules:actions.archive/ }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("lets completed and cancelled modules be archived", async () => {
    await openMenu(makeModule({ status: "cancelled" }));
    expect(
      screen.getByRole("menuitem", { name: "modules:actions.archive" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("offers restore, but no edit, for an archived module", async () => {
    const items = await openMenu(
      makeModule({
        status: "completed",
        archivedAt: "2026-04-01T00:00:00.000Z",
      }),
    );
    expect(items).toEqual([
      "modules:actions.copyLink",
      "modules:actions.restore",
    ]);
  });

  it("shows delete to the module's creator without module:delete", async () => {
    permissions.userId = "creator-1";
    const items = await openMenu();
    expect(items).toContain("modules:actions.delete");
  });

  it("hides delete from members who did not create the module", async () => {
    const items = await openMenu();
    expect(items).not.toContain("modules:actions.delete");
  });

  it("shows read-only roles only the link", async () => {
    permissions.canUpdateModules = false;
    permissions.userId = "creator-1";
    const items = await openMenu(makeModule({ status: "completed" }));
    expect(items).toEqual(["modules:actions.copyLink"]);
  });

  it("opens the project's analytics for the module with the capability", async () => {
    permissions.canUpdateModules = false;
    permissions.canReadAnalytics = true;
    const items = await openMenu(makeModule({ status: "completed" }));
    expect(items).toEqual([
      "modules:actions.copyLink",
      "analytics:openInAnalytics",
    ]);
    fireEvent.click(
      screen.getByRole("menuitem", { name: /analytics:openInAnalytics/ }),
    );
    expect(permissions.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/analytics",
      params: { workspaceId: "ws-1", projectId: "project-1" },
      search: { moduleId: "module-1" },
    });
  });
});
