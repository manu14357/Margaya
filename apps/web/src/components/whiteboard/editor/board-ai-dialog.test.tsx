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
import {
  brainstormWhiteboard,
  groupWhiteboardNotes,
  summarizeWhiteboard,
} from "@/fetchers/ai/whiteboard";
import { HttpError } from "@/lib/http-error";
import { BoardAiDialog, type BoardAiMode } from "./board-ai-dialog";
import { BoardController } from "./controller";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/fetchers/ai/whiteboard", () => ({
  brainstormWhiteboard: vi.fn(),
  groupWhiteboardNotes: vi.fn(),
  summarizeWhiteboard: vi.fn(),
}));

const brainstormMock = vi.mocked(brainstormWhiteboard);
const groupMock = vi.mocked(groupWhiteboardNotes);
const summarizeMock = vi.mocked(summarizeWhiteboard);
const controllers: BoardController[] = [];

function board(elements: BoardElement[], readOnly = false) {
  const doc = new Y.Doc();
  if (elements.length > 0) writeElements(doc, elements, "seed");
  const controller = new BoardController({
    doc,
    awareness: null,
    readOnly,
    user: { id: "me", name: "Me", color: "#2563eb" },
    whiteboardId: "board-1",
    theme: "light",
    imageUrl: (id) => id,
    isPublic: false,
  });
  controller.resize(1000, 800, 1);
  controllers.push(controller);
  return { doc, controller };
}

function open(controller: BoardController, mode: BoardAiMode) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BoardAiDialog
        mode={mode}
        onClose={onClose}
        controller={controller}
        whiteboardId="board-1"
      />
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => {
  brainstormMock.mockReset();
  groupMock.mockReset();
  summarizeMock.mockReset();
});

afterEach(() => {
  cleanup();
  for (const controller of controllers.splice(0)) controller.dispose();
});

describe("Brainstorm with AI", () => {
  it("previews editable ideas and adds them only on accept, as one undo step", async () => {
    const existing = createElement("rectangle", {
      x: 300,
      y: 200,
      width: 400,
      height: 400,
    });
    const { doc, controller } = board([existing]);
    brainstormMock.mockResolvedValue({
      title: "Onboarding",
      ideas: ["Buddy system", "Docs day", "Welcome video"],
    });
    const onClose = open(controller, "brainstorm");

    fireEvent.change(
      screen.getByPlaceholderText("whiteboardEditor:ai.topicPlaceholder"),
      { target: { value: "Faster onboarding" } },
    );
    fireEvent.click(screen.getByTestId("whiteboard-ai-generate"));
    await screen.findByDisplayValue("Docs day");
    expect(brainstormMock.mock.calls[0]?.[0]).toEqual({
      whiteboardId: "board-1",
      json: { prompt: "Faster onboarding", count: 8 },
    });
    // The preview writes nothing.
    expect(readElements(doc)).toHaveLength(1);

    // Edit one idea, drop another.
    fireEvent.change(screen.getByDisplayValue("Buddy system"), {
      target: { value: "Onboarding buddy" },
    });
    const [removeFirst] = screen.getAllByRole("button", {
      name: "whiteboardEditor:ai.removeIdea",
    });
    if (!removeFirst) throw new Error("no remove button");
    fireEvent.click(removeFirst);
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Onboarding buddy")).toBeNull(),
    );
    fireEvent.click(screen.getByTestId("whiteboard-ai-accept"));

    expect(onClose).toHaveBeenCalled();
    const added = readElements(doc).filter((e) => e.id !== existing.id);
    const frame = added.find((element) => element.type === "frame");
    const notes = added.filter((element) => element.type === "sticky");
    expect(frame).toMatchObject({ name: "Onboarding" });
    expect(notes.map((note) => note.type === "sticky" && note.text)).toEqual([
      "Docs day",
      "Welcome video",
    ]);
    expect(notes.every((note) => note.frameId === frame?.id)).toBe(true);
    // Placed clear of what was in the middle of the view.
    expect(
      (frame?.x ?? 0) >= 700 ||
        (frame?.y ?? 0) >= 600 ||
        (frame?.x ?? 0) + (frame?.width ?? 0) <= 300 ||
        (frame?.y ?? 0) + (frame?.height ?? 0) <= 200,
    ).toBe(true);

    controller.undo();
    expect(readElements(doc).filter((element) => !element.deleted)).toEqual([
      expect.objectContaining({ id: existing.id }),
    ]);
  });

  it("shows the AI error and writes nothing", async () => {
    const { doc, controller } = board([]);
    brainstormMock.mockRejectedValue(
      new HttpError(429, JSON.stringify({ code: "AI_BUDGET_EXCEEDED" })),
    );
    open(controller, "brainstorm");
    fireEvent.change(
      screen.getByPlaceholderText("whiteboardEditor:ai.topicPlaceholder"),
      { target: { value: "Ideas" } },
    );
    fireEvent.click(screen.getByTestId("whiteboard-ai-generate"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ai:errors.AI_BUDGET_EXCEEDED",
    );
    expect(screen.getByTestId("whiteboard-ai-accept")).toBeDisabled();
    expect(readElements(doc)).toHaveLength(0);
  });
});

describe("Group with AI", () => {
  it("asks for the selected notes and arranges them into frames on accept", async () => {
    const a = createElement("sticky", { x: 0, y: 0, text: "Slow builds" });
    const b = createElement("sticky", { x: 300, y: 0, text: "Flaky tests" });
    const c = createElement("sticky", { x: 600, y: 0, text: "Hiring" });
    const locked = createElement("sticky", { text: "Locked", locked: true });
    const { doc, controller } = board([a, b, c, locked]);
    controller.select([a.id, b.id, c.id, locked.id]);
    groupMock.mockResolvedValue({
      groups: [
        { title: "CI", elementIds: [a.id, b.id] },
        { title: null, elementIds: [c.id] },
      ],
    });
    const onClose = open(controller, "group");

    await screen.findByDisplayValue("CI");
    expect(groupMock.mock.calls[0]?.[0]).toEqual({
      whiteboardId: "board-1",
      json: { elementIds: [a.id, b.id, c.id] },
    });
    // A theme without a title reads as "Other".
    expect(
      screen.getByDisplayValue("whiteboardEditor:ai.otherGroup"),
    ).toBeInTheDocument();
    expect(readElements(doc)).toHaveLength(4);

    fireEvent.change(screen.getByDisplayValue("CI"), {
      target: { value: "Build pipeline" },
    });
    fireEvent.click(screen.getByTestId("whiteboard-ai-accept"));
    expect(onClose).toHaveBeenCalled();

    const frames = readElements(doc).filter((e) => e.type === "frame");
    expect(frames.map((frame) => frame.type === "frame" && frame.name)).toEqual(
      ["Build pipeline", "whiteboardEditor:ai.otherGroup"],
    );
    expect(readElement(doc, a.id)?.frameId).toBe(frames[0]?.id);
    expect(readElement(doc, b.id)?.frameId).toBe(frames[0]?.id);
    expect(readElement(doc, c.id)?.frameId).toBe(frames[1]?.id);
    expect(readElement(doc, locked.id)?.frameId).toBeNull();
    expect(controller.state.selectedIds).toEqual(frames.map((f) => f.id));

    // One undo puts the notes back and removes the frames.
    controller.undo();
    expect(readElement(doc, a.id)).toMatchObject({ x: 0, y: 0, frameId: null });
    expect(
      readElements(doc).filter((e) => e.type === "frame" && !e.deleted),
    ).toHaveLength(0);
  });
});

describe("Summarize with AI", () => {
  it("summarizes the selection, then adds an edited summary as text", async () => {
    const note = createElement("sticky", { x: 0, y: 0, text: "Plan" });
    const { doc, controller } = board([note]);
    controller.select([note.id]);
    summarizeMock.mockResolvedValue({
      title: "Plan",
      summary: "- Ship it",
      elementCount: 1,
    });
    open(controller, "summarize");

    await screen.findByDisplayValue("- Ship it");
    expect(summarizeMock.mock.calls[0]?.[0]).toEqual({
      whiteboardId: "board-1",
      json: { elementIds: [note.id] },
    });
    fireEvent.change(screen.getByDisplayValue("- Ship it"), {
      target: { value: "- Ship it Friday" },
    });
    fireEvent.click(screen.getByTestId("whiteboard-ai-accept"));

    const text = readElements(doc).find((element) => element.type === "text");
    expect(text?.type === "text" && text.text).toBe("Plan\n\n- Ship it Friday");
  });

  it("asks for the whole board and offers only Copy on a read-only board", async () => {
    const { doc, controller } = board(
      [createElement("sticky", { text: "Idea" })],
      true,
    );
    summarizeMock.mockResolvedValue({
      title: "Board",
      summary: "- One idea",
      elementCount: 1,
    });
    open(controller, "summarize");
    await screen.findByDisplayValue("- One idea");
    expect(summarizeMock.mock.calls[0]?.[0]).toEqual({
      whiteboardId: "board-1",
      json: {},
    });
    expect(screen.queryByTestId("whiteboard-ai-accept")).toBeNull();
    expect(
      screen.getByRole("button", { name: "whiteboardEditor:ai.copy" }),
    ).toBeEnabled();
    expect(readElements(doc)).toHaveLength(1);
  });
});
