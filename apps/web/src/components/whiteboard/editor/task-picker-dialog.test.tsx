import { readElements } from "@margaya/whiteboard";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type Task from "@/types/task";
import { BoardController } from "./controller";
import { TaskPickerDialog } from "./task-picker-dialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const controllers: BoardController[] = [];

function setup(tasks: Task[], { isLoading = false } = {}) {
  const doc = new Y.Doc();
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
  const onOpenChange = vi.fn();
  render(
    <TaskPickerDialog
      open
      onOpenChange={onOpenChange}
      controller={controller}
      tasks={tasks}
      projectSlug="WEB"
      isLoading={isLoading}
    />,
  );
  return { doc, onOpenChange };
}

const task = (id: string, number: number, title: string) =>
  ({ id, number, title }) as Task;

afterEach(() => {
  cleanup();
  for (const controller of controllers.splice(0)) controller.dispose();
});

describe("TaskPickerDialog", () => {
  it("never offers to add 0 cards: the button waits, and a hint says why", () => {
    setup([task("t1", 1, "Write the brief"), task("t2", 2, "Ship it")]);
    const add = screen.getByTestId("whiteboard-add-task-cards");
    expect(add).toHaveTextContent("whiteboardEditor:tasks.addCardsNone");
    expect(add).not.toHaveTextContent(/:0$/);
    expect(add).toBeDisabled();
    const hint = screen.getByText("whiteboardEditor:tasks.pickHint");
    expect(add).toHaveAttribute("aria-describedby", hint.id);
  });

  it("counts the picked tasks and adds one card for each", () => {
    const { doc, onOpenChange } = setup([
      task("t1", 1, "Write the brief"),
      task("t2", 2, "Ship it"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Write the brief/ }));
    fireEvent.click(screen.getByRole("button", { name: /Ship it/ }));
    const add = screen.getByTestId("whiteboard-add-task-cards");
    expect(add).toHaveTextContent("whiteboardEditor:tasks.addCards:2");
    expect(add).toBeEnabled();
    expect(add).not.toHaveAttribute("aria-describedby");
    expect(
      screen.queryByText("whiteboardEditor:tasks.pickHint"),
    ).not.toBeInTheDocument();

    fireEvent.click(add);
    expect(
      readElements(doc)
        .filter((element) => element.type === "task")
        .map((element) => (element.type === "task" ? element.taskId : null)),
    ).toEqual(["t1", "t2"]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows no hint when there is nothing to pick", () => {
    setup([]);
    expect(screen.getByText("whiteboardEditor:tasks.noResults")).toBeVisible();
    expect(
      screen.queryByText("whiteboardEditor:tasks.pickHint"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("whiteboard-add-task-cards")).not.toHaveAttribute(
      "aria-describedby",
    );
  });
});
