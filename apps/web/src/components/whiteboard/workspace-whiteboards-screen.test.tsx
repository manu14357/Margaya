import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceWhiteboardsScreen, {
  WORKSPACE_WHITEBOARDS_GROUP_STORAGE_KEY,
} from "./workspace-whiteboards-screen";

type Board = Record<string, unknown>;

const m = vi.hoisted(() => ({
  boards: [] as Board[],
  projects: [] as Array<Record<string, unknown>>,
  query: { isLoading: false, isError: false, isFetching: false },
  filters: [] as Array<{ archived: boolean; q: string }>,
  refetch: vi.fn(),
  create: vi.fn(),
  navigate: vi.fn(),
  caps: { create: true, update: true, delete: false, checking: false },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
    ...props
  }: {
    children?: ReactNode;
    params?: Record<string, string>;
    to?: string;
  }) => (
    <a
      data-to={to}
      data-params={JSON.stringify(params)}
      {...(props as Record<string, unknown>)}
    >
      {children}
    </a>
  ),
  useNavigate: () => m.navigate,
}));
vi.mock("@/components/common/workspace-layout", () => ({
  default: ({
    title,
    headerActions,
    children,
  }: {
    title: string;
    headerActions?: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <header data-testid="top-bar">
        <h1>{title}</h1>
        {headerActions}
      </header>
      {children}
    </div>
  ),
}));
vi.mock("@/components/common/project-layout", () => ({ default: () => null }));
vi.mock("@/components/project/project-feature-gate", () => ({
  default: () => null,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: undefined }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: m.projects, isSuccess: true }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "me" } } }) },
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateWhiteboards: () => m.caps.create,
    canUpdateWhiteboards: () => m.caps.update,
    canDeleteWhiteboards: () => m.caps.delete,
    isCheckingPermissions: m.caps.checking,
  }),
}));
vi.mock("@/hooks/queries/whiteboard/use-workspace-whiteboards", () => ({
  useWorkspaceWhiteboards: (
    _workspaceId: string,
    filters: { archived: boolean; q: string },
  ) => {
    m.filters.push(filters);
    return { ...m.query, data: { whiteboards: m.boards }, refetch: m.refetch };
  },
}));
vi.mock("@/hooks/mutations/whiteboard/use-whiteboard-mutations", () => {
  const idle = () => ({ mutate: vi.fn(), isPending: false });
  return {
    useCreateWhiteboard: () => ({ mutate: m.create, isPending: false }),
    useUpdateWhiteboard: idle,
    useDuplicateWhiteboard: idle,
    useSetWhiteboardLock: idle,
    useSetWhiteboardArchived: idle,
    useDeleteWhiteboard: idle,
    useSetWhiteboardPublished: idle,
  };
});

const apollo = { id: "p1", name: "Apollo", slug: "AP", icon: "Layout" };
const zephyr = { id: "p2", name: "Zephyr", slug: "ZE", icon: "Layout" };

function board(overrides: Board = {}): Board {
  const project = (overrides.project as typeof apollo | undefined) ?? apollo;
  return {
    id: "wb1",
    workspaceId: "w1",
    projectId: project.id,
    title: "Sprint plan",
    icon: null,
    isLocked: false,
    lockedBy: null,
    lockedAt: null,
    archivedAt: null,
    publicToken: null,
    publishedAt: null,
    elementCount: 0,
    contentVersion: 1,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-10T00:00:00Z",
    createdBy: { id: "someone", name: "Ann", image: null },
    updatedBy: { id: "someone", name: "Ann", image: null },
    project,
    ...overrides,
  };
}

// Radio and checkbox items keep the menu open; open it only when closed.
const openFilter = () => {
  if (screen.queryByRole("menu")) return;
  fireEvent.click(
    screen.getByRole("button", { name: "whiteboards:workspace.projectFilter" }),
  );
};

function renderScreen() {
  return render(<WorkspaceWhiteboardsScreen workspaceId="w1" />);
}

beforeEach(() => {
  m.boards = [];
  m.projects = [
    { ...apollo, whiteboardsEnabled: true },
    { ...zephyr, whiteboardsEnabled: true },
    { id: "p3", name: "Off", icon: "Layout", whiteboardsEnabled: false },
  ];
  m.query = { isLoading: false, isError: false, isFetching: false };
  m.filters = [];
  m.refetch.mockReset();
  m.create.mockReset();
  m.navigate.mockReset();
  m.caps = { create: true, update: true, delete: false, checking: false };
  window.localStorage.removeItem(WORKSPACE_WHITEBOARDS_GROUP_STORAGE_KEY);
  vi.stubEnv("VITE_API_URL", "http://localhost:1337");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("WorkspaceWhiteboardsScreen", () => {
  it("shows skeleton cards while loading", () => {
    m.query.isLoading = true;
    const { container } = renderScreen();
    expect(
      container.querySelectorAll("div[aria-hidden=true].border").length,
    ).toBe(8);
  });

  it("offers a retry when the list fails", () => {
    m.query.isError = true;
    renderScreen();
    fireEvent.click(screen.getByText("whiteboards:list.retry"));
    expect(m.refetch).toHaveBeenCalled();
  });

  it("explains when no project has whiteboards on", () => {
    m.projects = [{ id: "p3", name: "Off", whiteboardsEnabled: false }];
    renderScreen();
    expect(
      screen.getByText("whiteboards:workspace.empty.noProjectsTitle"),
    ).toBeTruthy();
    expect(screen.queryByText("whiteboards:list.newWhiteboard")).toBeNull();
  });

  it("groups boards by project, each heading linking to the project's list", () => {
    m.boards = [
      board({ id: "a", title: "Alpha", project: zephyr }),
      board({ id: "b", title: "Beta" }),
      board({ id: "c", title: "Gamma", project: zephyr }),
    ];
    renderScreen();
    const groups = screen.getAllByRole("region");
    expect(
      groups.map((group) => group.getAttribute("aria-labelledby")),
    ).toEqual(["wb-group-p2", "wb-group-p1"]);
    const zephyrGroup = within(groups[0] as HTMLElement);
    expect(zephyrGroup.getByText("Alpha")).toBeTruthy();
    expect(zephyrGroup.getByText("Gamma")).toBeTruthy();
    expect(zephyrGroup.queryByText("Beta")).toBeNull();
    const heading = zephyrGroup.getByText("Zephyr").closest("a");
    expect(heading?.getAttribute("data-params")).toBe(
      JSON.stringify({ workspaceId: "w1", projectId: "p2" }),
    );
  });

  it("opens each card in its board's project", () => {
    m.boards = [board({ id: "a", title: "Alpha", project: zephyr })];
    renderScreen();
    const link = screen.getByLabelText("Alpha");
    expect(link.getAttribute("data-params")).toBe(
      JSON.stringify({ workspaceId: "w1", projectId: "p2", whiteboardId: "a" }),
    );
  });

  it("filters to one project and turns grouping off", async () => {
    m.boards = [
      board({ id: "a", title: "Alpha", project: zephyr }),
      board({ id: "b", title: "Beta" }),
    ];
    renderScreen();
    openFilter();
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Apollo" }),
    );
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.queryAllByRole("region")).toHaveLength(0);

    openFilter();
    fireEvent.click(
      await screen.findByRole("menuitemradio", {
        name: "whiteboards:workspace.allProjects",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", {
        name: "whiteboards:workspace.groupByProject",
      }),
    );
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    expect(
      window.localStorage.getItem(WORKSPACE_WHITEBOARDS_GROUP_STORAGE_KEY),
    ).toBe("false");
  });

  it("creates a board in the project the person picks", async () => {
    renderScreen();
    const bar = within(screen.getByTestId("top-bar"));
    fireEvent.click(bar.getByText("whiteboards:list.newWhiteboard"));
    expect(
      await screen.findByText("whiteboards:workspace.chooseProject"),
    ).toBeTruthy();
    // Only projects with Whiteboards on are offered.
    expect(screen.queryByRole("menuitem", { name: "Off" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Zephyr" }));
    expect(m.create).toHaveBeenCalledWith(
      { projectId: "p2" },
      expect.anything(),
    );
    const options = m.create.mock.calls[0]?.[1] as
      | { onSuccess: (created: { id: string }) => void }
      | undefined;
    options?.onSuccess({ id: "new" });
    expect(m.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { workspaceId: "w1", projectId: "p2", whiteboardId: "new" },
      }),
    );
  });

  it("hides creation from people without whiteboard:create", () => {
    m.caps.create = false;
    renderScreen();
    expect(screen.queryByText("whiteboards:list.newWhiteboard")).toBeNull();
  });

  it("sends the search and the archived tab to the list query", () => {
    renderScreen();
    fireEvent.change(
      screen.getByLabelText("whiteboards:list.searchPlaceholder"),
      { target: { value: "retro" } },
    );
    expect(m.filters.at(-1)).toEqual({ archived: false, q: "retro" });
    expect(
      screen.getByText('whiteboards:list.empty.noMatchTitle {"query":"retro"}'),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("whiteboards:list.tabs.archived"));
    expect(m.filters.at(-1)).toEqual({ archived: true, q: "retro" });
  });
});
