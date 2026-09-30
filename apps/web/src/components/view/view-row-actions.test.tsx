import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedView } from "@/types/view";
import ViewRowActions from "./view-row-actions";

const mocks = vi.hoisted(() => ({
  canCreate: true,
  setLock: vi.fn(),
  duplicate: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateViews: () => mocks.canCreate,
    isCheckingPermissions: false,
  }),
}));

vi.mock("@/hooks/mutations/view/use-view-mutations", () => ({
  useDuplicateView: () => ({ mutate: mocks.duplicate }),
  useSetViewLock: () => ({ mutate: mocks.setLock }),
}));

vi.mock("@/components/favorite/favorite-button", () => ({
  default: () => <div>favorite</div>,
}));

vi.mock("./view-form-dialog", () => ({ default: () => null }));
vi.mock("./delete-view-dialog", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  mocks.canCreate = true;
  vi.clearAllMocks();
});

function makeView(overrides: Partial<SavedView> = {}): SavedView {
  return {
    id: "v1",
    workspaceId: "w1",
    projectId: "p1",
    name: "Open bugs",
    description: "",
    access: "workspace",
    isLocked: false,
    lockedBy: null,
    ownerId: "u1",
    owner: { id: "u1", name: "Ann", image: null },
    canEdit: true,
    canDelete: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as SavedView;
}

async function openMenu(view = makeView()) {
  render(<ViewRowActions view={view} />);
  fireEvent.click(screen.getByRole("button", { name: "views:actions.menu" }));
  await screen.findByRole("menuitem", { name: /views:actions.copyLink/ });
  return screen
    .getAllByRole("menuitem")
    .map((item) => item.textContent ?? "")
    .filter((text) => text !== "favorite");
}

describe("ViewRowActions", () => {
  it("offers every action to the owner or an admin", async () => {
    expect(await openMenu()).toEqual([
      "views:actions.edit",
      "views:actions.duplicate",
      "views:actions.copyLink",
      "views:lock.lock",
      "views:actions.delete",
    ]);
  });

  it("offers only duplicate and link to other members", async () => {
    expect(
      await openMenu(makeView({ canEdit: false, canDelete: false })),
    ).toEqual(["views:actions.duplicate", "views:actions.copyLink"]);
  });

  it("disables edit and delete while locked, and offers unlock", async () => {
    await openMenu(makeView({ isLocked: true }));
    expect(
      screen.getByRole("menuitem", { name: /views:actions.edit/ }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("menuitem", { name: /views:actions.delete/ }),
    ).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(
      screen.getByRole("menuitem", { name: /views:lock.unlock/ }),
    );
    expect(mocks.setLock).toHaveBeenCalledWith(
      { viewId: "v1", locked: false },
      expect.anything(),
    );
  });

  it("hides duplicate without view:create", async () => {
    mocks.canCreate = false;
    expect(await openMenu()).not.toContain("views:actions.duplicate");
  });
});
