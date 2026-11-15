import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WhiteboardsScreen from "./whiteboards-screen";

type Board = Record<string, unknown>;

const m = vi.hoisted(() => ({
  boards: [] as Board[],
  query: {
    isLoading: false,
    isError: false,
    isFetching: false,
  },
  filters: [] as Array<{ archived: boolean; q: string }>,
  refetch: vi.fn(),
  create: vi.fn(),
  navigate: vi.fn(),
  caps: {
    create: true,
    update: true,
    delete: false,
    checking: false,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children?: ReactNode }) => (
    <a {...(props as Record<string, unknown>)}>{children}</a>
  ),
  useNavigate: () => m.navigate,
}));
vi.mock("@/components/common/project-layout", () => ({
  default: ({
    headerActions,
    children,
  }: {
    headerActions?: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <header data-testid="top-bar">{headerActions}</header>
      {children}
    </div>
  ),
}));
vi.mock("@/components/project/project-feature-gate", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: { id: "p1", name: "Apollo" } }),
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
vi.mock("@/hooks/queries/whiteboard/use-whiteboards", () => ({
  useWhiteboards: (
    _projectId: string,
    filters: { archived: boolean; q: string },
  ) => {
    m.filters.push(filters);
    return {
      ...m.query,
      data: { whiteboards: m.boards },
      refetch: m.refetch,
    };
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
vi.mock("@/lib/whiteboards/whiteboard-templates", () => ({
  WHITEBOARD_TEMPLATES: [
    {
      id: "blank",
      icon: () => null,
      nameKey: "whiteboards:templates.names.blank",
      descriptionKey: "whiteboards:templates.descriptions.blank",
    },
    {
      id: "retrospective",
      icon: () => null,
      nameKey: "whiteboards:templates.names.retrospective",
      descriptionKey: "whiteboards:templates.descriptions.retrospective",
    },
  ],
  buildTemplateElements: (id: string) =>
    id === "blank" ? [] : [{ id: "e1", type: "sticky" }],
}));

function board(overrides: Board = {}): Board {
  return {
    id: "wb1",
    workspaceId: "w1",
    projectId: "p1",
    title: "Sprint plan",
    icon: null,
    isLocked: false,
    lockedBy: null,
    lockedAt: null,
    archivedAt: null,
    publicToken: null,
    publishedAt: null,
    elementCount: 3,
    contentVersion: 7,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-10T00:00:00Z",
    createdBy: { id: "someone", name: "Ann", image: null },
    updatedBy: { id: "someone", name: "Ann", image: null },
    ...overrides,
  };
}

function renderScreen() {
  return render(<WhiteboardsScreen workspaceId="w1" projectId="p1" />);
}

beforeEach(() => {
  m.boards = [];
  m.query = { isLoading: false, isError: false, isFetching: false };
  m.filters = [];
  m.refetch.mockReset();
  m.create.mockReset();
  m.navigate.mockReset();
  m.caps = { create: true, update: true, delete: false, checking: false };
  vi.stubEnv("VITE_API_URL", "http://localhost:1337");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("WhiteboardsScreen", () => {
  it("shows skeleton cards while loading", () => {
    m.query.isLoading = true;
    const { container } = renderScreen();
    expect(
      container.querySelectorAll("div[aria-hidden=true].border").length,
    ).toBe(8);
    expect(screen.queryByText("whiteboards:list.empty.title")).toBeNull();
  });

  it("offers a retry when the list fails", () => {
    m.query.isError = true;
    renderScreen();
    fireEvent.click(screen.getByText("whiteboards:list.retry"));
    expect(m.refetch).toHaveBeenCalled();
  });

  it("invites people who may create to start a board", () => {
    renderScreen();
    expect(screen.getByText("whiteboards:list.empty.title")).toBeTruthy();
    const main = screen
      .getByText("whiteboards:list.empty.title")
      .closest("[data-slot=empty]") as HTMLElement | null;
    const scope = main ? within(main) : screen;
    fireEvent.click(scope.getByText("whiteboards:list.newWhiteboard"));
    expect(m.create).toHaveBeenCalledWith(
      { projectId: "p1" },
      expect.anything(),
    );
  });

  it("hides creation from people without whiteboard:create", () => {
    m.caps.create = false;
    renderScreen();
    expect(screen.queryByText("whiteboards:list.newWhiteboard")).toBeNull();
    expect(
      screen.queryByLabelText("whiteboards:list.moreCreateOptions"),
    ).toBeNull();
  });

  it("renders cards with a versioned preview image and badges", () => {
    m.boards = [board({ isLocked: true, publicToken: "tok" })];
    renderScreen();
    expect(screen.getByText("Sprint plan")).toBeTruthy();
    const image = document.querySelector("img");
    expect(image?.getAttribute("src")).toBe(
      "http://localhost:1337/api/whiteboard/wb1/preview.svg?v=7",
    );
    expect(screen.getByText("whiteboards:list.locked")).toBeTruthy();
    expect(screen.getByText("whiteboards:list.published")).toBeTruthy();
  });

  it("gates card actions by what the viewer may do", async () => {
    m.boards = [board()];
    m.caps = { create: false, update: false, delete: false, checking: false };
    const { unmount } = renderScreen();
    fireEvent.click(
      screen.getByLabelText(
        'whiteboards:list.cardActions {"title":"Sprint plan"}',
      ),
    );
    expect(
      await screen.findByText("whiteboards:actions.copyLink"),
    ).toBeTruthy();
    expect(screen.queryByText("whiteboards:actions.rename")).toBeNull();
    expect(screen.queryByText("whiteboards:actions.archive")).toBeNull();
    unmount();

    m.caps = { create: true, update: true, delete: true, checking: false };
    renderScreen();
    fireEvent.click(
      screen.getByLabelText(
        'whiteboards:list.cardActions {"title":"Sprint plan"}',
      ),
    );
    expect(await screen.findByText("whiteboards:actions.rename")).toBeTruthy();
    expect(screen.getByText("whiteboards:actions.archive")).toBeTruthy();
    expect(screen.getByText("whiteboards:actions.publish")).toBeTruthy();
    expect(screen.queryByText("whiteboards:actions.moveToTrash")).toBeNull();
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
  });

  it("shows the archived empty state with a link to the trash", () => {
    renderScreen();
    fireEvent.click(screen.getByText("whiteboards:list.tabs.archived"));
    expect(m.filters.at(-1)).toEqual({ archived: true, q: "" });
  });

  it("creates a board from a template with its elements and name", () => {
    renderScreen();
    fireEvent.click(
      screen.getByLabelText("whiteboards:list.moreCreateOptions"),
    );
    fireEvent.click(
      screen.getByText("whiteboards:templates.names.retrospective"),
    );
    expect(m.create).toHaveBeenCalledWith(
      {
        projectId: "p1",
        title: "whiteboards:templates.names.retrospective",
        elements: [{ id: "e1", type: "sticky" }],
      },
      expect.anything(),
    );
  });
});
