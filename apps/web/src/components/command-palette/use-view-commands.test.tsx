import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewCommands } from "./use-view-commands";

const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  canCreate: true,
  viewsOn: true,
  listCalls: [] as Array<{ projectId: string | null; enabled?: boolean }>,
  dialogProps: null as null | Record<string, unknown>,
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => m.navigate }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateViews: () => m.canCreate,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/use-project-features", () => ({
  useProjectFeatures: () => ({ isEnabled: () => m.viewsOn }),
}));
vi.mock("@/hooks/queries/view/use-get-views", () => ({
  useGetViews: (options: { projectId: string | null; enabled?: boolean }) => {
    m.listCalls.push(options);
    return {
      data: options.projectId
        ? [{ id: "pv", name: "Project view", projectId: "p1" }]
        : [{ id: "wv", name: "Workspace view", projectId: null }],
    };
  },
}));
vi.mock("@/components/view/view-form-dialog", () => ({
  default: (props: Record<string, unknown>) => {
    m.dialogProps = props;
    return null;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  m.canCreate = true;
  m.viewsOn = true;
  m.listCalls = [];
  m.dialogProps = null;
});
afterEach(cleanup);

describe("useViewCommands", () => {
  it("opens the project's and the workspace's views", () => {
    const { result } = renderHook(() =>
      useViewCommands({ workspaceId: "w1", projectId: "p1", open: true }),
    );
    const labels = result.current.items.map((item) => item.label);
    expect(labels).toEqual([
      "Project view",
      "Workspace view",
      "navigation:commandPalette.newView",
    ]);

    result.current.items[0].onRun();
    expect(m.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/w1/project/p1/views/pv",
    });
    result.current.items[1].onRun();
    expect(m.navigate).toHaveBeenLastCalledWith({
      to: "/dashboard/workspace/w1/views/wv",
    });
  });

  it("creates a new view in the current project", () => {
    const { result } = renderHook(() =>
      useViewCommands({ workspaceId: "w1", projectId: "p1", open: true }),
    );
    render(<div>{result.current.dialog}</div>);
    expect(m.dialogProps).toMatchObject({ open: false, projectId: "p1" });

    act(() => result.current.items.at(-1)?.onRun());
    render(<div>{result.current.dialog}</div>);
    expect(m.dialogProps).toMatchObject({ open: true, projectId: "p1" });
  });

  it("uses workspace views only where project views are off", () => {
    m.viewsOn = false;
    const { result } = renderHook(() =>
      useViewCommands({ workspaceId: "w1", projectId: "p1", open: true }),
    );
    expect(result.current.items.map((item) => item.label)).toEqual([
      "Workspace view",
      "navigation:commandPalette.newView",
    ]);
    render(<div>{result.current.dialog}</div>);
    expect(m.dialogProps).toMatchObject({ projectId: null });
  });

  it("offers no New view without view:create, and loads nothing while closed", () => {
    m.canCreate = false;
    const { result } = renderHook(() =>
      useViewCommands({ workspaceId: "w1", projectId: undefined, open: false }),
    );
    expect(result.current.dialog).toBeNull();
    expect(result.current.items.some((item) => item.value === "new-view")).toBe(
      false,
    );
    expect(m.listCalls.every((call) => call.enabled === false)).toBe(true);
  });
});
