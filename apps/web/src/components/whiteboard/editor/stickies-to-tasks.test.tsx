import {
  type BoardElement,
  createElement,
  readElement,
  readElements,
  writeElements,
} from "@margaya/whiteboard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import createTask from "@/fetchers/task/create-task";
import { BoardController } from "./controller";
import {
  createTasksForDrafts,
  descriptionFromSticky,
  draftsFor,
  replaceStickies,
  titleFromSticky,
} from "./stickies-to-tasks";
import { TurnIntoTasksDialog } from "./turn-into-tasks-dialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/fetchers/task/create-task", () => ({
  default: vi.fn(),
}));

const createTaskMock = vi.mocked(createTask);
const controllers: BoardController[] = [];

function board(elements: BoardElement[]) {
  const doc = new Y.Doc();
  writeElements(doc, elements, "seed");
  const controller = new BoardController({
    doc,
    awareness: null,
    readOnly: false,
    user: { id: "me", name: "Me", color: "#2563eb" },
    whiteboardId: "board-1",
    theme: "light",
    imageUrl: (id) => id,
    isPublic: false,
  });
  controllers.push(controller);
  return { doc, controller };
}

beforeEach(() => {
  let next = 0;
  createTaskMock.mockReset();
  createTaskMock.mockImplementation(async (title: string) => {
    if (title === "Fails") throw new Error("server said no");
    next += 1;
    return { id: `task-${next}`, title } as never;
  });
});

afterEach(() => {
  cleanup();
  for (const controller of controllers.splice(0)) controller.dispose();
});

describe("sticky text", () => {
  it("uses the first non-empty line as the title and the rest as the description", () => {
    expect(titleFromSticky("\n  Ship the beta \nwith docs\nand a post")).toBe(
      "Ship the beta",
    );
    expect(
      descriptionFromSticky("\n  Ship the beta \nwith docs\nand a post"),
    ).toBe("with docs\nand a post");
    expect(titleFromSticky("   ")).toBe("");
  });
});

describe("stickies to tasks", () => {
  it("creates one task per sticky and skips empty titles", async () => {
    const stickies = [
      createElement("sticky", { text: "First" }),
      createElement("sticky", { text: "  " }),
      createElement("sticky", { text: "Fails" }),
    ];
    const create = vi.fn(async (input: { title: string }) => {
      if (input.title === "Fails") throw new Error("no");
      return { id: `id-${input.title}` };
    });
    const { done, failed } = await createTasksForDrafts(
      draftsFor(stickies, "to-do"),
      "p1",
      create,
    );
    expect(done).toEqual([{ stickyId: stickies[0]?.id, taskId: "id-First" }]);
    expect(failed.map((entry) => entry.stickyId)).toEqual([
      stickies[1]?.id,
      stickies[2]?.id,
    ]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        title: "First",
        status: "to-do",
      }),
    );
  });

  it("replaces stickies with task cards in place and re-points arrows at them", () => {
    const sticky = createElement("sticky", {
      x: 40,
      y: 60,
      width: 200,
      height: 200,
      text: "A",
    });
    const other = createElement("rectangle", { x: 400, y: 60 });
    const arrow = createElement("arrow", {
      x: 240,
      y: 160,
      points: [
        [0, 0],
        [160, 0],
      ],
      startBinding: { elementId: sticky.id, focus: [1, 0.5], gap: 6 },
      endBinding: { elementId: other.id, focus: [0, 0.5], gap: 6 },
    });
    const { writes, cards } = replaceStickies(
      [sticky, other, arrow],
      [{ sticky, taskId: "task-9" }],
      "me",
    );
    const cardId = cards.get(sticky.id);
    const card = writes.find((element) => element.id === cardId);
    expect(card).toMatchObject({
      type: "task",
      taskId: "task-9",
      x: 40,
      y: 60,
      order: sticky.order,
    });
    expect(writes.find((element) => element.id === sticky.id)?.deleted).toBe(
      true,
    );
    const rebound = writes.find((element) => element.id === arrow.id);
    expect(rebound?.type === "arrow" && rebound.startBinding?.elementId).toBe(
      cardId,
    );
    expect(rebound?.type === "arrow" && rebound.endBinding?.elementId).toBe(
      other.id,
    );
  });

  it("runs the whole dialog flow with the task API mocked", async () => {
    const first = createElement("sticky", {
      x: 0,
      y: 0,
      text: "Write the plan\nwith dates",
    });
    const second = createElement("sticky", { x: 300, y: 0, text: "Fails" });
    const { doc, controller } = board([first, second]);
    controller.select([first.id, second.id]);
    const onOpenChange = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TurnIntoTasksDialog
          open
          onOpenChange={onOpenChange}
          controller={controller}
          projectId="p1"
          columns={[
            { id: "c1", name: "To do", slug: "to-do" },
            { id: "c2", name: "Done", slug: "done" },
          ]}
        />
      </QueryClientProvider>,
    );

    const titles = await screen.findAllByRole("textbox");
    expect(titles.map((input) => (input as HTMLInputElement).value)).toEqual([
      "Write the plan",
      "Fails",
    ]);
    fireEvent.click(screen.getByTestId("whiteboard-create-tasks"));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(createTaskMock).toHaveBeenCalledTimes(2);
    expect(createTaskMock.mock.calls[0]?.[0]).toBe("Write the plan");
    expect(createTaskMock.mock.calls[0]?.[1]).toBe("with dates");
    expect(createTaskMock.mock.calls[0]?.[2]).toBe("p1");
    expect(createTaskMock.mock.calls[0]?.[4]).toBe("to-do");

    // The converted sticky is now a card in the same place; the failed one stays.
    expect(readElement(doc, first.id)?.deleted).toBe(true);
    expect(readElement(doc, second.id)?.deleted).toBe(false);
    const card = readElements(doc).find((element) => element.type === "task");
    expect(card).toMatchObject({ taskId: "task-1", x: 0, y: 0 });
    expect(controller.state.selectedIds).toEqual([card?.id]);

    // One undo brings the sticky back.
    controller.undo();
    expect(readElement(doc, first.id)?.deleted).toBe(false);
    expect(readElements(doc).some((element) => element.type === "task")).toBe(
      false,
    );
  });
});
