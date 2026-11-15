import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRailDestinations } from "./app-rail";

const m = vi.hoisted(() => ({
  projects: [] as Array<{ id: string; whiteboardsEnabled?: boolean }>,
  workspaceIds: [] as string[],
  can: { analytics: true, whiteboards: true },
  checking: false,
  guest: false,
  layout: null as Record<string, unknown> | null,
}));

// The rail's menus and switcher pull in the whole shell; the hook needs none.
vi.mock("@/components/common/shell-menus", () => ({}));
vi.mock("@/components/workspace-switcher", () => ({}));
vi.mock("@/components/common/use-shell-badges", () => ({}));
vi.mock("@/components/desktop/desktop-title-bar", () => ({}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canReadAnalytics: () => m.can.analytics,
    canReadWhiteboards: () => m.can.whiteboards,
    isCheckingPermissions: m.checking,
    isGuest: m.guest,
  }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: ({ workspaceId }: { workspaceId: string }) => {
    m.workspaceIds.push(workspaceId);
    return { data: m.projects };
  },
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    select: (state: { sidebarLayout: unknown }) => unknown,
  ) => select({ sidebarLayout: m.layout }),
}));

const rail = () => renderHook(() => useRailDestinations()).result.current;

beforeEach(() => {
  m.projects = [{ id: "p1", whiteboardsEnabled: true }];
  m.workspaceIds = [];
  m.can = { analytics: true, whiteboards: true };
  m.checking = false;
  m.guest = false;
  m.layout = null;
});

afterEach(cleanup);

describe("useRailDestinations", () => {
  it("places Whiteboards right after Pages", () => {
    expect(rail()).toEqual([
      "home",
      "inbox",
      "my-work",
      "projects",
      "pages",
      "whiteboards",
      "analytics",
    ]);
    expect(m.workspaceIds).toContain("w1");
  });

  it("hides Whiteboards until a project has them on", () => {
    m.projects = [{ id: "p1", whiteboardsEnabled: false }];
    expect(rail()).not.toContain("whiteboards");
    m.projects = [];
    expect(rail()).not.toContain("whiteboards");
  });

  it("hides Whiteboards without whiteboard:read or while checking", () => {
    m.can.whiteboards = false;
    expect(rail()).not.toContain("whiteboards");
    m.can.whiteboards = true;
    m.checking = true;
    expect(rail()).not.toContain("whiteboards");
    expect(rail()).not.toContain("analytics");
  });

  it("keeps guests to their own destinations", () => {
    m.guest = true;
    expect(rail()).toEqual(["inbox", "my-work", "projects"]);
  });

  it("respects a user who hid Whiteboards", () => {
    m.layout = { railHidden: ["whiteboards"] };
    expect(rail()).not.toContain("whiteboards");
    expect(rail()).toContain("pages");
  });
});
