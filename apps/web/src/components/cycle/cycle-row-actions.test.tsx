import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CycleRowActions from "./cycle-row-actions";
import { makeCycle } from "./test-fixtures";

const permissions = vi.hoisted(() => ({
  canUpdateCycles: true,
  canReadAnalytics: false,
  navigate: vi.fn(),
  canDeleteCycles: false,
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
    canUpdateCycles: () => permissions.canUpdateCycles,
    canReadAnalytics: () => permissions.canReadAnalytics,
    canDeleteCycles: () => permissions.canDeleteCycles,
  }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: permissions.userId } } }),
  },
}));

vi.mock("@/hooks/mutations/cycle/use-archive-cycle", () => ({
  useArchiveCycle: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/components/favorite/favorite-button", () => ({
  default: () => <div>favorite</div>,
}));

vi.mock("./cycle-form-dialog", () => ({ default: () => null }));
vi.mock("./delete-cycle-dialog", () => ({ default: () => null }));
vi.mock("./transfer-tasks-dialog", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  permissions.canUpdateCycles = true;
  permissions.canReadAnalytics = false;
  permissions.navigate.mockReset();
  permissions.canDeleteCycles = false;
  permissions.userId = "someone";
});

async function openMenu(cycle = makeCycle()) {
  render(<CycleRowActions cycle={cycle} workspaceId="ws-1" />);
  fireEvent.click(screen.getByRole("button", { name: "cycles:actions.menu" }));
  await screen.findByRole("menuitem", { name: /cycles:actions.copyLink/ });
  return screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
}

describe("CycleRowActions", () => {
  it("offers edit, a disabled archive and delete for a running cycle", async () => {
    permissions.canDeleteCycles = true;
    const items = await openMenu(makeCycle({ status: "current" }));
    expect(items).toEqual([
      "cycles:actions.edit",
      "cycles:actions.copyLink",
      "cycles:actions.archivecycles:actions.archiveDisabledHint",
      "cycles:actions.delete",
    ]);
    const archive = screen.getByRole("menuitem", {
      name: /cycles:actions.archive/,
    });
    expect(archive).toHaveAttribute("aria-disabled", "true");
  });

  it("offers transfer and archive, but no edit or delete, when completed", async () => {
    permissions.canDeleteCycles = true;
    const items = await openMenu(
      makeCycle({ status: "completed", pending: 2 }),
    );
    expect(items).toEqual([
      "cycles:actions.copyLink",
      "cycles:actions.transfer",
      "cycles:actions.archive",
    ]);
  });

  it("offers only restore for an archived cycle", async () => {
    permissions.canDeleteCycles = true;
    const items = await openMenu(
      makeCycle({
        status: "completed",
        pending: 2,
        archivedAt: "2026-03-20T00:00:00.000Z",
      }),
    );
    expect(items).toEqual([
      "cycles:actions.copyLink",
      "cycles:actions.restore",
    ]);
  });

  it("lets the owner delete their own cycle without cycle:delete", async () => {
    permissions.userId = "owner-1";
    const items = await openMenu(makeCycle({ status: "draft" }));
    expect(items).toContain("cycles:actions.delete");
  });

  it("hides delete from other members", async () => {
    const items = await openMenu(makeCycle({ status: "upcoming" }));
    expect(items).not.toContain("cycles:actions.delete");
  });

  it("shows read-only roles only the link and favorite", async () => {
    permissions.canUpdateCycles = false;
    permissions.userId = "owner-1";
    const items = await openMenu(
      makeCycle({ status: "completed", pending: 1 }),
    );
    expect(items).toEqual(["cycles:actions.copyLink"]);
  });

  it("opens the project's analytics for the cycle with the capability", async () => {
    permissions.canUpdateCycles = false;
    permissions.canReadAnalytics = true;
    const items = await openMenu(makeCycle({ status: "current" }));
    expect(items).toEqual([
      "cycles:actions.copyLink",
      "analytics:openInAnalytics",
    ]);
    fireEvent.click(
      screen.getByRole("menuitem", { name: /analytics:openInAnalytics/ }),
    );
    expect(permissions.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/analytics",
      params: { workspaceId: "ws-1", projectId: "project-1" },
      search: { cycleId: "cycle-1" },
    });
  });
});
