import {
  type BoardElement,
  createElement,
  writeElements,
} from "@margaya/whiteboard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { BoardController } from "./controller";
import { DependencyPrompt, useDependencyPrompt } from "./dependency-prompt";
import { Interaction } from "./interaction";
import type { DependencyLink } from "./selection-info";

const mocks = vi.hoisted(() => ({
  getTaskRelations: vi.fn(),
  deleteTaskRelation: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/fetchers/task-relation/get-task-relations", () => ({
  default: mocks.getTaskRelations,
}));
vi.mock("@/fetchers/task-relation/delete-task-relation", () => ({
  default: mocks.deleteTaskRelation,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

type Prompt = ReturnType<typeof useDependencyPrompt>;

function relation(
  id: string,
  source: [string, number],
  target: [string, number],
  relationType = "blocks",
) {
  return {
    id,
    sourceTaskId: source[0],
    targetTaskId: target[0],
    relationType,
    sourceTask: { projectSlug: "KEY", number: source[1], title: "A" },
    targetTask: { projectSlug: "KEY", number: target[1], title: "B" },
  };
}

function link(sourceTaskId: string, targetTaskId: string): DependencyLink {
  return {
    arrowId: `${sourceTaskId}-${targetTaskId}`,
    sourceTaskId,
    targetTaskId,
  };
}

function mount(enabled = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const ref: { current: Prompt | null } = { current: null };
  function Harness() {
    const prompt = useDependencyPrompt({ enabled, cardKey: () => null });
    ref.current = prompt;
    return (
      <DependencyPrompt
        items={prompt.items}
        onRemove={prompt.remove}
        onKeep={prompt.keep}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  const ask = async (links: DependencyLink[]) => {
    await act(async () => {
      await ref.current?.ask(links);
    });
  };
  return { ask, invalidate };
}

beforeEach(() => {
  mocks.getTaskRelations.mockReset();
  mocks.deleteTaskRelation.mockReset().mockResolvedValue({});
  mocks.success.mockReset();
  mocks.error.mockReset();
});

afterEach(cleanup);

describe("dependency prompt", () => {
  it("asks about the relation and removes it on Remove", async () => {
    mocks.getTaskRelations.mockResolvedValue([
      relation("r1", ["t1", 1], ["t2", 2]),
    ]);
    const { ask, invalidate } = mount();
    await ask([link("t1", "t2")]);
    expect(mocks.getTaskRelations).toHaveBeenCalledWith("t1");
    expect(
      screen.getByTestId("whiteboard-dependency-prompt"),
    ).toHaveTextContent(
      'whiteboardEditor:tasks.removeDependencyPrompt {"source":"KEY-1","target":"KEY-2"}',
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "whiteboardEditor:tasks.removeDependencyConfirm",
      }),
    );
    await waitFor(() =>
      expect(mocks.deleteTaskRelation).toHaveBeenCalledWith("r1"),
    );
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.success.mock.calls[0]?.[0]).toContain(
      "whiteboardEditor:tasks.dependencyRemoved",
    );
    for (const taskId of ["t1", "t2"]) {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["task-relations", taskId],
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["activities", taskId],
      });
    }
    expect(screen.queryByTestId("whiteboard-dependency-prompt")).toBeNull();
  });

  it("leaves the relation alone on Keep", async () => {
    mocks.getTaskRelations.mockResolvedValue([
      relation("r1", ["t1", 1], ["t2", 2]),
    ]);
    const { ask } = mount();
    await ask([link("t1", "t2")]);
    fireEvent.click(
      screen.getByRole("button", {
        name: "whiteboardEditor:tasks.keepDependency",
      }),
    );
    expect(screen.queryByTestId("whiteboard-dependency-prompt")).toBeNull();
    expect(mocks.deleteTaskRelation).not.toHaveBeenCalled();
  });

  it("stays quiet when the arrow stood for no blocking relation", async () => {
    mocks.getTaskRelations.mockResolvedValue([
      // Another type, and the opposite direction, are not this arrow.
      relation("r1", ["t1", 1], ["t2", 2], "related"),
      relation("r2", ["t2", 2], ["t1", 1]),
    ]);
    const { ask } = mount();
    await ask([link("t1", "t2")]);
    expect(screen.queryByTestId("whiteboard-dependency-prompt")).toBeNull();

    mocks.getTaskRelations.mockRejectedValue(new Error("offline"));
    await ask([link("t1", "t2")]);
    expect(screen.queryByTestId("whiteboard-dependency-prompt")).toBeNull();
  });

  it("never asks when switched off (read-only or public boards)", async () => {
    mocks.getTaskRelations.mockResolvedValue([
      relation("r1", ["t1", 1], ["t2", 2]),
    ]);
    const { ask } = mount(false);
    await ask([link("t1", "t2")]);
    expect(mocks.getTaskRelations).not.toHaveBeenCalled();
    expect(screen.queryByTestId("whiteboard-dependency-prompt")).toBeNull();
  });

  it("covers a batch delete in one prompt", async () => {
    mocks.getTaskRelations.mockImplementation(async (taskId: string) =>
      taskId === "t1"
        ? [relation("r1", ["t1", 1], ["t2", 2])]
        : taskId === "t3"
          ? [relation("r2", ["t3", 3], ["t4", 4])]
          : [],
    );
    const { ask } = mount();
    // The same pair twice is asked about once; t5 -> t6 has no relation.
    await ask([
      link("t1", "t2"),
      link("t1", "t2"),
      link("t3", "t4"),
      link("t5", "t6"),
    ]);
    const prompt = screen.getByTestId("whiteboard-dependency-prompt");
    expect(prompt).toHaveTextContent(
      'whiteboardEditor:tasks.removeDependenciesPrompt {"count":2}',
    );
    expect(prompt).toHaveTextContent(
      'whiteboardEditor:tasks.dependencyPair {"source":"KEY-3","target":"KEY-4"}',
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "whiteboardEditor:tasks.removeDependencyConfirm",
      }),
    );
    await waitFor(() =>
      expect(mocks.deleteTaskRelation).toHaveBeenCalledTimes(2),
    );
    expect(mocks.deleteTaskRelation).toHaveBeenCalledWith("r1");
    expect(mocks.deleteTaskRelation).toHaveBeenCalledWith("r2");
    await waitFor(() =>
      expect(mocks.success.mock.calls[0]?.[0]).toContain('{"count":2}'),
    );
  });

  it("says so when a removal fails", async () => {
    mocks.getTaskRelations.mockResolvedValue([
      relation("r1", ["t1", 1], ["t2", 2]),
    ]);
    mocks.deleteTaskRelation.mockRejectedValue(new Error("forbidden"));
    const { ask } = mount();
    await ask([link("t1", "t2")]);
    fireEvent.click(
      screen.getByRole("button", {
        name: "whiteboardEditor:tasks.removeDependencyConfirm",
      }),
    );
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        "whiteboardEditor:tasks.dependencyRemoveFailed",
      ),
    );
  });
});

// ----- which deletes report dependency arrows ---------------------------------

const controllers: BoardController[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});

function card(id: string, taskId: string, x: number): BoardElement {
  return createElement("task", {
    id,
    taskId,
    x,
    y: 0,
    width: 100,
    height: 60,
  } as never);
}

function arrow(id: string, from: string, to: string, y = 30): BoardElement {
  return createElement("arrow", {
    id,
    x: 100,
    y,
    points: [
      [0, 0],
      [100, 0],
    ],
    startBinding: { elementId: from, focus: [0.5, 0.5], gap: 6 },
    endBinding: { elementId: to, focus: [0.5, 0.5], gap: 6 },
  } as never);
}

function board(elements: BoardElement[], readOnly = false) {
  const doc = new Y.Doc();
  writeElements(doc, elements, "seed");
  const controller = new BoardController({
    doc,
    awareness: null,
    readOnly,
    user: { id: "me", name: "Me", color: "#2563eb" },
    whiteboardId: "b",
    theme: "light",
    imageUrl: (id) => id,
    isPublic: false,
  });
  const removed = vi.fn();
  controller.callbacks = { notice: vi.fn(), dependencyArrowsRemoved: removed };
  controllers.push(controller);
  return { controller, removed };
}

describe("deleting dependency arrows", () => {
  const elements = () => [
    card("a", "t1", 0),
    card("b", "t2", 200),
    card("c", "t3", 400),
    createElement("rectangle", {
      id: "r",
      x: 600,
      y: 0,
      width: 100,
      height: 60,
    } as never),
    arrow("ab", "a", "b"),
    arrow("bc", "b", "c", 55),
    arrow("cr", "c", "r", 80),
  ];

  it("reports every deleted arrow between two task cards, once per delete", () => {
    const { controller, removed } = board(elements());
    controller.remove(["ab", "bc", "cr"]);
    expect(removed).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith([
      { arrowId: "ab", sourceTaskId: "t1", targetTaskId: "t2" },
      { arrowId: "bc", sourceTaskId: "t2", targetTaskId: "t3" },
    ]);
  });

  it("skips arrows that do not join two task cards", () => {
    const { controller, removed } = board(elements());
    controller.remove(["cr"]);
    // Deleting a card only unbinds its arrows; no arrow was deleted.
    controller.remove(["a"]);
    expect(removed).not.toHaveBeenCalled();
  });

  it("reports arrows the eraser removes", () => {
    const { controller, removed } = board(elements());
    const interaction = new Interaction(controller, {
      editText: vi.fn(),
      openTask: vi.fn(),
      openLink: vi.fn(),
    });
    controller.dispatchTool({ type: "pick", tool: "eraser", readOnly: false });
    const at = (x: number, y: number) =>
      ({
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        clientX: x,
        clientY: y,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        preventDefault: () => {},
      }) as unknown as PointerEvent;
    interaction.pointerDown(at(150, 30));
    interaction.pointerUp(at(150, 30));
    expect(removed).toHaveBeenCalledWith([
      { arrowId: "ab", sourceTaskId: "t1", targetTaskId: "t2" },
    ]);
  });

  it("reports nothing on a read-only board", () => {
    const { controller, removed } = board(elements(), true);
    controller.remove(["ab"]);
    expect(removed).not.toHaveBeenCalled();
  });
});
