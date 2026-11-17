import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import WhiteboardScreen from "./whiteboard-screen";

type Board = Record<string, unknown>;

const m = vi.hoisted(() => ({
  board: null as Board | null,
  boardError: null as unknown,
  refetch: vi.fn(),
  collab: {} as Record<string, unknown>,
  editorProps: [] as Array<Record<string, unknown>>,
  lock: vi.fn(),
  archive: vi.fn(),
  saveAs: vi.fn(),
}));

vi.mock("file-saver", () => ({ saveAs: m.saveAs }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
}));
// Outside a crowded top bar: nothing to host, the menu shows as it is.
vi.mock("@/components/common/header/top-bar-overflow", () => ({
  useTopBarOverflowHost: () => null,
  TopBarOverflowMenuItems: () => null,
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
vi.mock("@/hooks/use-project-features", () => ({
  useProjectFeatures: () => ({
    isEnabled: () => true,
    project: { name: "Apollo" },
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: "me", name: "Me", email: "me@x.test", image: null } },
    }),
  },
}));
vi.mock("@/components/page/use-page-members", () => ({
  usePageMembers: () => ({ getMember: () => null }),
}));
vi.mock("@/hooks/queries/whiteboard/use-whiteboard", () => ({
  useWhiteboard: () => ({
    data: m.board ?? undefined,
    error: m.boardError,
    isError: Boolean(m.boardError),
    refetch: m.refetch,
  }),
}));
vi.mock("./use-whiteboard-collaboration", () => ({
  useWhiteboardCollaboration: () => m.collab,
}));
vi.mock("./editor/whiteboard-editor", () => ({
  WhiteboardEditor: (props: Record<string, unknown>) => {
    m.editorProps.push(props);
    return <div data-testid="whiteboard-editor" />;
  },
}));
vi.mock("@/hooks/mutations/whiteboard/use-whiteboard-mutations", () => {
  const idle = () => ({ mutate: vi.fn(), isPending: false });
  return {
    useUpdateWhiteboard: idle,
    useDuplicateWhiteboard: idle,
    useSetWhiteboardLock: () => ({ mutate: m.lock, isPending: false }),
    useSetWhiteboardArchived: () => ({ mutate: m.archive, isPending: false }),
    useDeleteWhiteboard: idle,
    useSetWhiteboardPublished: idle,
  };
});

const doc = { guid: "doc-1" };

function liveCollab(overrides: Record<string, unknown> = {}) {
  return {
    doc,
    awareness: {},
    status: "connected",
    synced: true,
    hasSynced: true,
    canWrite: true,
    terminal: null,
    pendingOffline: false,
    presence: [],
    lastSavedAt: null,
    saveError: false,
    fallback: false,
    storedCopy: { isLoading: false, isError: false },
    failedAttempts: 0,
    tooLarge: false,
    retry: vi.fn(),
    ...overrides,
  };
}

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
    createdBy: null,
    updatedBy: null,
    capabilities: {
      canEdit: true,
      canManage: true,
      canPublish: true,
      canDuplicate: true,
    },
    ...overrides,
  };
}

function renderScreen() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <WhiteboardScreen
        workspaceId="w1"
        projectId="p1"
        whiteboardId="wb1"
        elementId="el-9"
      />
    </QueryClientProvider>,
  );
}

const lastEditor = () => m.editorProps.at(-1) ?? {};

beforeEach(() => {
  m.board = board();
  m.boardError = null;
  m.refetch.mockReset();
  m.collab = liveCollab();
  m.editorProps = [];
  m.lock.mockReset();
  m.archive.mockReset();
});

afterEach(cleanup);

describe("WhiteboardScreen", () => {
  it("mounts the editor editable with the live document and the element", () => {
    renderScreen();
    expect(screen.getByTestId("whiteboard-editor")).toBeTruthy();
    expect(lastEditor()).toMatchObject({
      doc,
      readOnly: false,
      whiteboardId: "wb1",
      projectId: "p1",
      workspaceId: "w1",
      initialElementId: "el-9",
      user: { id: "me", name: "Me" },
    });
    expect(typeof lastEditor().uploadImage).toBe("function");
    expect((lastEditor().imageUrl as (id: string) => string)("a1")).toMatch(
      /\/whiteboard\/wb1\/assets\/a1$/,
    );
  });

  it("is read-only with a banner for people without whiteboard:update", () => {
    m.board = board({
      capabilities: {
        canEdit: false,
        canManage: false,
        canPublish: false,
        canDuplicate: false,
      },
    });
    renderScreen();
    expect(lastEditor()).toMatchObject({ readOnly: true });
    expect(lastEditor().uploadImage).toBeUndefined();
    expect(screen.getByText("whiteboards:banners.readOnly")).toBeTruthy();
    expect(screen.queryByLabelText("whiteboards:actions.lock")).toBeNull();
    expect(screen.queryByLabelText("whiteboards:actions.share")).toBeNull();
  });

  it("shows who locked the board and lets a manager unlock it", () => {
    m.board = board({
      isLocked: true,
      lockedBy: { id: "ann", name: "Ann" },
      capabilities: {
        canEdit: false,
        canManage: true,
        canPublish: true,
        canDuplicate: true,
      },
    });
    renderScreen();
    expect(lastEditor()).toMatchObject({ readOnly: true });
    expect(
      screen.getByText('whiteboards:banners.lockedBy {"name":"Ann"}'),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("whiteboards:banners.unlock"));
    expect(m.lock).toHaveBeenCalledWith(
      { whiteboardId: "wb1", projectId: "p1", locked: false },
      expect.anything(),
    );
  });

  it("shows the archived banner with a restore for managers", () => {
    m.board = board({
      archivedAt: "2026-11-12T00:00:00Z",
      capabilities: {
        canEdit: false,
        canManage: true,
        canPublish: false,
        canDuplicate: true,
      },
    });
    renderScreen();
    expect(screen.getByText("whiteboards:banners.archived")).toBeTruthy();
    expect(screen.queryByLabelText("whiteboards:actions.lock")).toBeNull();
    fireEvent.click(screen.getByText("whiteboards:banners.restore"));
    expect(m.archive).toHaveBeenCalledWith(
      { whiteboardId: "wb1", projectId: "p1", archived: false },
      expect.anything(),
    );
  });

  it("stays read-only when the room refuses writes", () => {
    m.collab = liveCollab({ canWrite: false });
    renderScreen();
    expect(lastEditor()).toMatchObject({ readOnly: true });
  });

  it("shows the stored copy read-only, without awareness, with a retry", () => {
    const retry = vi.fn();
    m.collab = liveCollab({
      fallback: true,
      awareness: null,
      hasSynced: false,
      retry,
    });
    renderScreen();
    expect(lastEditor()).toMatchObject({ readOnly: true, awareness: null });
    fireEvent.click(screen.getByText("whiteboards:banners.retry"));
    expect(retry).toHaveBeenCalled();
  });

  it("shows a skeleton until the document exists", () => {
    m.collab = liveCollab({ doc: null });
    renderScreen();
    expect(screen.queryByTestId("whiteboard-editor")).toBeNull();
  });

  it("shows not found for a missing or foreign board", () => {
    m.board = null;
    m.boardError = new HttpError(404, "Whiteboard not found");
    renderScreen();
    expect(screen.getByText("whiteboards:screen.notFound.title")).toBeTruthy();
    expect(screen.queryByTestId("whiteboard-editor")).toBeNull();
  });

  it("exports a PNG with the board embedded through the editor handle", async () => {
    const png = new Blob(["png"], { type: "image/png" });
    const exportPng = vi.fn().mockResolvedValue(png);
    renderScreen();
    const onReady = lastEditor().onReady as (handle: unknown) => void;
    act(() =>
      onReady({
        exportPng,
        exportSvg: vi.fn(),
        exportFile: vi.fn(),
        importFile: vi.fn(),
        zoomToFit: vi.fn(),
        scrollToElement: vi.fn(),
      }),
    );
    fireEvent.click(screen.getByLabelText("whiteboards:actions.export"));
    fireEvent.click(await screen.findByText("whiteboards:actions.exportPng"));
    await waitFor(() =>
      expect(m.saveAs).toHaveBeenCalledWith(png, "Sprint plan.png"),
    );
    expect(exportPng).toHaveBeenCalledWith({
      scale: 2,
      background: true,
      embedScene: true,
      theme: "light",
    });
  });

  it("offers a retry when the board fails to load", () => {
    m.board = null;
    m.boardError = new HttpError(500, "boom");
    renderScreen();
    fireEvent.click(screen.getByText("whiteboards:list.retry"));
    expect(m.refetch).toHaveBeenCalled();
  });
});
