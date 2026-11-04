import type { DragEndEvent } from "@dnd-kit/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BacklogListView from "@/components/backlog-list-view";
import ListView from "@/components/list-view";
import type { ProjectWithTasks } from "@/types/project";
import KanbanBoard from "./index";

// Every drag surface: a move must write only the position and, for the card
// that changed column, the status. Anything else in the card is the board's
// possibly stale copy, and sending it would undo a colleague's newer edit.

const m = vi.hoisted(() => ({
  onDragEnd: undefined as ((event: DragEndEvent) => void) | undefined,
  mutate: vi.fn(),
}));

vi.mock("@dnd-kit/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dnd-kit/core")>()),
  // Only the drop handler matters here; none of the rows need to render.
  DndContext: (props: { onDragEnd: (event: DragEndEvent) => void }) => {
    m.onDragEnd = props.onDragEnd;
    return null;
  },
}));
vi.mock("@/hooks/mutations/task/use-update-task-position", () => ({
  useUpdateTaskPosition: () => ({ mutate: m.mutate }),
}));
vi.mock("@/hooks/mutations/task/use-bulk-operations", () => ({
  useBulkOperations: () => ({ bulkArchive: vi.fn() }),
}));
vi.mock("@/hooks/mutations/task/use-archive-task", () => ({
  useArchiveTask: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/task/use-update-task-status", () => ({
  useUpdateTaskStatus: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-keyboard-shortcuts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-keyboard-shortcuts")>()),
  useRegisterShortcuts: () => {},
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateTasks: () => true,
    canUpdateTasks: () => true,
  }),
}));
vi.mock("@/components/list-view/use-list-triage", () => ({
  useListTriage: () => {},
}));
vi.mock("@/components/task-draft/use-capture-host", () => ({
  useCaptureHost: () => {},
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function card(id: string, status: string, position: number) {
  return {
    id,
    status,
    position,
    projectId: "p1",
    title: `Stale title of ${id}`,
    description: "Stale description",
    priority: "low",
    startDate: "2031-01-01T00:00:00.000Z",
    dueDate: "2031-02-01T00:00:00.000Z",
    userId: "someone",
  };
}

const project = {
  id: "p1",
  workspaceId: "w1",
  slug: "P",
  columns: [
    {
      id: "to-do",
      slug: "to-do",
      name: "To do",
      tasks: [card("a", "to-do", 0), card("b", "to-do", 1)],
    },
    {
      id: "done",
      slug: "done",
      name: "Done",
      tasks: [card("c", "done", 0), card("d", "done", 1)],
    },
  ],
  plannedTasks: [
    card("p", "planned", 0),
    card("q", "planned", 1),
    card("r", "planned", 2),
  ],
  archivedTasks: [],
} as unknown as ProjectWithTasks;

function drop(active: string, over: string) {
  act(() => {
    m.onDragEnd?.({
      active: { id: active },
      over: { id: over },
    } as unknown as DragEndEvent);
  });
}

function writes() {
  return m.mutate.mock.calls.map(([variables]) => variables);
}

beforeEach(() => m.mutate.mockReset());
afterEach(cleanup);

describe.each([
  ["board", KanbanBoard],
  ["list view", ListView],
])("moving a card on the %s", (_name, View) => {
  it("sends the status for the moved card and only positions for the rest", () => {
    render(<View project={project} />);

    drop("a", "c");

    expect(writes()).toEqual(
      expect.arrayContaining([
        { id: "a", projectId: "p1", position: 1, status: "done" },
        { id: "d", projectId: "p1", position: 2 },
        { id: "b", projectId: "p1", position: 0 },
      ]),
    );
    expect(writes()).toHaveLength(3);
  });

  it("sends only positions for a reorder inside a column", () => {
    render(<View project={project} />);

    drop("a", "b");

    expect(writes()).toEqual([
      { id: "b", projectId: "p1", position: 0 },
      { id: "a", projectId: "p1", position: 1 },
    ]);
  });
});

describe("moving a row in the backlog", () => {
  it("sends only positions", () => {
    render(<BacklogListView project={project} />);

    drop("p", "q");

    expect(writes()).toEqual([
      { id: "q", projectId: "p1", position: 0 },
      { id: "p", projectId: "p1", position: 1 },
      { id: "r", projectId: "p1", position: 2 },
    ]);
  });
});
