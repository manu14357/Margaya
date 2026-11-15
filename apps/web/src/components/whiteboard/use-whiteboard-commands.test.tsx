import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWhiteboardCommands } from "./use-whiteboard-commands";

const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  projects: [] as Array<{ id: string; whiteboardsEnabled: boolean }>,
  projectOn: true,
  canRead: true,
  guest: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => m.navigate }));
vi.mock("@/hooks/mutations/whiteboard/use-whiteboard-mutations", () => ({
  useCreateWhiteboard: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: m.projects }),
}));
vi.mock("@/hooks/use-project-features", () => ({
  useProjectFeatures: () => ({ isEnabled: () => m.projectOn }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canReadWhiteboards: () => m.canRead,
    canCreateWhiteboards: () => true,
    isCheckingPermissions: false,
    isGuest: m.guest,
  }),
}));

const values = (projectId?: string) =>
  renderHook(() =>
    useWhiteboardCommands({ workspaceId: "w1", projectId }),
  ).result.current.map((command) => command.value);

beforeEach(() => {
  m.navigate.mockReset();
  m.projects = [{ id: "p1", whiteboardsEnabled: true }];
  m.projectOn = true;
  m.canRead = true;
  m.guest = false;
});

afterEach(cleanup);

describe("useWhiteboardCommands", () => {
  it("offers all whiteboards anywhere in the workspace", () => {
    const [command] = renderHook(() =>
      useWhiteboardCommands({ workspaceId: "w1", projectId: undefined }),
    ).result.current;
    expect(command?.value).toBe("all-whiteboards");
    expect(command?.label).toBe(
      "whiteboards:commandPalette.goToAllWhiteboards",
    );
    command?.onRun();
    expect(m.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/whiteboards",
      params: { workspaceId: "w1" },
    });
  });

  it("adds the project's entries inside a project", () => {
    expect(values("p1")).toEqual([
      "all-whiteboards",
      "whiteboards",
      "create-whiteboard",
    ]);
  });

  it("leaves all whiteboards out where the rail does", () => {
    m.projects = [{ id: "p1", whiteboardsEnabled: false }];
    expect(values()).toEqual([]);
    m.projects = [{ id: "p1", whiteboardsEnabled: true }];
    m.guest = true;
    expect(values()).toEqual([]);
    m.guest = false;
    m.canRead = false;
    expect(values()).toEqual([]);
  });
});
