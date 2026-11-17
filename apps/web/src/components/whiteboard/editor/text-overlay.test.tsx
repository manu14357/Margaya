import {
  type BoardElement,
  createElement,
  readElement,
  writeElements,
} from "@margaya/whiteboard";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { refitText } from "./commands";
import { BoardController } from "./controller";
import { fitLabel, isComposingKey, TextOverlay } from "./text-overlay";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const controllers: BoardController[] = [];

function setup(elements: BoardElement[]) {
  const doc = new Y.Doc();
  writeElements(doc, elements, "seed");
  const controller = new BoardController({
    doc,
    awareness: null,
    readOnly: false,
    user: { id: "me", name: "Me", color: "#2563eb" },
    whiteboardId: "b",
    theme: "light",
    imageUrl: (id) => id,
    isPublic: false,
  });
  controller.callbacks = { notice: vi.fn() };
  controllers.push(controller);
  return { doc, controller };
}

afterEach(() => {
  cleanup();
  for (const controller of controllers.splice(0)) controller.dispose();
});

describe("the text overlay", () => {
  it("leaves the keys an input method is handling to it", () => {
    expect(isComposingKey({ nativeEvent: { isComposing: true } })).toBe(true);
    expect(isComposingKey({ keyCode: 229 })).toBe(true);
    expect(isComposingKey({ nativeEvent: { isComposing: false } })).toBe(false);
  });

  it("keeps editing when Escape cancels a composition, and commits on the next one", () => {
    const sticky = createElement("sticky", { text: "" });
    const { doc, controller } = setup([sticky]);
    const onDone = vi.fn();
    render(
      <TextOverlay
        controller={controller}
        elementId={sticky.id}
        isNew={false}
        onDone={onDone}
      />,
    );
    const field = screen.getByTestId("whiteboard-text-editor");
    fireEvent.change(field, { target: { value: "日本語" } });
    act(() => {
      fireEvent.keyDown(field, { key: "Escape", isComposing: true });
      fireEvent.keyDown(field, { key: "Escape", keyCode: 229 });
    });
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      fireEvent.keyDown(field, { key: "Escape" });
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(readElement(doc, sticky.id)).toMatchObject({ text: "日本語" });
  });

  it("leaves room below the last line, so the field never scrolls its words", () => {
    const sticky = createElement("sticky", {
      text: "one line",
      fontSize: 20,
    });
    const { controller } = setup([sticky]);
    render(
      <TextOverlay
        controller={controller}
        elementId={sticky.id}
        isNew={false}
        onDone={vi.fn()}
      />,
    );
    const field = screen.getByTestId("whiteboard-text-editor");
    // One line of 20 × 1.25, half a line to spare, and the border allowance.
    expect(Number.parseFloat(field.style.height)).toBe(25 + 10 + 2);
  });
});

describe("refitting text", () => {
  it("sizes an auto-sized text to its words in the new font", () => {
    const text = createElement("text", {
      text: "Grow me",
      fontSize: 20,
      width: 10,
      height: 10,
      autoSize: true,
    });
    const bigger = refitText({ ...text, fontSize: 40 } as BoardElement);
    const smaller = refitText({ ...text, fontSize: 16 } as BoardElement);
    expect(bigger.width).toBeGreaterThan(smaller.width);
    expect(bigger.height).toBe(50);
    expect(smaller.height).toBe(20);
  });

  it("keeps a fixed-width text's width and grows its height", () => {
    const text = createElement("text", {
      text: "a fairly long sentence that wraps",
      fontSize: 20,
      width: 80,
      height: 25,
      autoSize: false,
    });
    const refit = refitText(text);
    expect(refit.width).toBe(80);
    expect(refit.height).toBeGreaterThan(25);
  });

  it("leaves other elements alone", () => {
    const rect = createElement("rectangle", { width: 10 });
    expect(refitText(rect)).toBe(rect);
  });
});

describe("labels that outgrow their shape", () => {
  it("makes a shape taller to hold a long label, keeping its width", () => {
    const rect = createElement("rectangle", {
      width: 100,
      height: 80,
      fontSize: 20,
      text: "Start here with a long label that wraps over many lines",
    } as never);
    const fitted = fitLabel(rect);
    expect(fitted.width).toBe(100);
    expect(fitted.height).toBeGreaterThan(80);
    // Tall enough now: fitting again changes nothing.
    expect(fitLabel(fitted).height).toBe(fitted.height);
  });

  it("never shrinks a shape whose label fits", () => {
    const rect = createElement("rectangle", {
      width: 200,
      height: 200,
      fontSize: 20,
      text: "Short",
    } as never);
    expect(fitLabel(rect)).toBe(rect);
  });

  it("grows an ellipse enough for its smaller label box", () => {
    const ellipse = createElement("ellipse", {
      width: 120,
      height: 60,
      fontSize: 20,
      text: "a label that needs several lines inside an ellipse",
    } as never);
    const fitted = fitLabel(ellipse);
    expect(fitted.height).toBeGreaterThan(60);
    expect(fitLabel(fitted).height).toBe(fitted.height);
  });

  it("grows a shape on commit and keeps it one undo step", () => {
    const rect = createElement("rectangle", {
      width: 100,
      height: 80,
      fontSize: 20,
      text: "",
    } as never);
    const { doc, controller } = setup([rect]);
    render(
      <TextOverlay
        controller={controller}
        elementId={rect.id}
        isNew={false}
        onDone={vi.fn()}
      />,
    );
    const field = screen.getByTestId("whiteboard-text-editor");
    fireEvent.change(field, {
      target: { value: "Start here with a long label that wraps" },
    });
    act(() => {
      fireEvent.keyDown(field, { key: "Escape" });
    });
    expect(readElement(doc, rect.id)?.height).toBeGreaterThan(80);
    controller.undo();
    expect(readElement(doc, rect.id)).toMatchObject({ height: 80, text: "" });
  });

  it("writes a new note with its words when the editor closes", () => {
    const { doc, controller } = setup([]);
    const note = createElement("sticky", { x: 0, y: 0, text: "" });
    controller.setPreview([note], { live: false });
    render(
      <TextOverlay
        controller={controller}
        elementId={note.id}
        isNew
        onDone={vi.fn()}
      />,
    );
    const field = screen.getByTestId("whiteboard-text-editor");
    fireEvent.change(field, { target: { value: "Idea" } });
    act(() => {
      fireEvent.keyDown(field, { key: "Escape" });
    });
    expect(readElement(doc, note.id)).toMatchObject({
      type: "sticky",
      text: "Idea",
    });
    controller.undo();
    expect(readElement(doc, note.id)?.deleted ?? true).toBe(true);
  });
});
