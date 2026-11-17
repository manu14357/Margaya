import { createElement } from "@margaya/whiteboard";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { BottomBar, Minimap, paintMinimapElement } from "./chrome";
import { BoardController } from "./controller";
import { EditorContext } from "./use-editor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const controllers: BoardController[] = [];

function mount(compact: boolean) {
  const controller = new BoardController({
    doc: new Y.Doc(),
    awareness: null,
    readOnly: false,
    user: { id: "me", name: "Me", color: "#2563eb" },
    whiteboardId: "board-1",
    theme: "light",
    imageUrl: (id) => id,
    isPublic: false,
  });
  controllers.push(controller);
  render(
    <EditorContext.Provider value={controller}>
      <BottomBar
        compact={compact}
        extra={<button type="button">Style</button>}
      />
    </EditorContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  for (const controller of controllers.splice(0)) controller.dispose();
});

describe("BottomBar", () => {
  it("shows every control on a wide board", () => {
    mount(false);
    expect(
      screen.getByRole("button", {
        name: "whiteboardEditor:commands.toggleMinimap",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "whiteboardEditor:zoom.in" }),
    ).not.toHaveClass("pointer-coarse:hidden");
  });

  it("fits a phone: no minimap toggle, and touch zooms with a pinch", () => {
    mount(true);
    // The minimap never shows on a compact board, so its toggle would do nothing.
    expect(
      screen.queryByRole("button", {
        name: "whiteboardEditor:commands.toggleMinimap",
      }),
    ).not.toBeInTheDocument();
    for (const name of [
      "whiteboardEditor:zoom.in",
      "whiteboardEditor:zoom.out",
    ])
      expect(screen.getByRole("button", { name })).toHaveClass(
        "pointer-coarse:hidden",
      );
    // What stays: reset and fit, undo and redo, help and the Style button.
    expect(
      screen.getByRole("button", { name: "whiteboardEditor:zoom.fit" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "whiteboardEditor:commands.help" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Style" })).toBeInTheDocument();
  });
});

describe("Minimap", () => {
  function recorder() {
    const calls: string[] = [];
    const ctx = {
      beginPath: () => calls.push("beginPath"),
      moveTo: (x: number, y: number) => calls.push(`moveTo ${x},${y}`),
      lineTo: (x: number, y: number) => calls.push(`lineTo ${x},${y}`),
      stroke: () => calls.push("stroke"),
      strokeRect: (...r: number[]) => calls.push(`strokeRect ${r.join(",")}`),
      fillRect: (...r: number[]) => calls.push(`fillRect ${r.join(",")}`),
    };
    return { ctx, calls };
  }
  const layout = { x: 0, y: 0, scale: 0.5 };

  it("draws an arrow as its line, not as a filled box", () => {
    const { ctx, calls } = recorder();
    paintMinimapElement(
      ctx,
      createElement("arrow", {
        x: 10,
        y: 20,
        points: [
          [0, 0],
          [100, 40],
        ],
      }),
      layout,
    );
    expect(calls).toEqual([
      "beginPath",
      "moveTo 5,10",
      "lineTo 55,30",
      "stroke",
    ]);
  });

  it("outlines a frame so what it holds still shows", () => {
    const { ctx, calls } = recorder();
    paintMinimapElement(
      ctx,
      createElement("frame", { x: 0, y: 0, width: 200, height: 100 }),
      layout,
    );
    expect(calls).toEqual(["strokeRect 0,0,100,50"]);
  });

  it("fills a shape's bounds", () => {
    const { ctx, calls } = recorder();
    paintMinimapElement(
      ctx,
      createElement("rectangle", { x: 0, y: 0, width: 40, height: 20 }),
      layout,
    );
    expect(calls).toEqual(["fillRect 0,0,20,10"]);
  });

  it("moves the view only with the main button", () => {
    const controller = new BoardController({
      doc: new Y.Doc(),
      awareness: null,
      readOnly: false,
      user: { id: "me", name: "Me", color: "#2563eb" },
      whiteboardId: "board-1",
      theme: "light",
      imageUrl: (id) => id,
      isPublic: false,
    });
    controllers.push(controller);
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
    render(
      <EditorContext.Provider value={controller}>
        <Minimap controller={controller} />
      </EditorContext.Provider>,
    );
    const map = screen.getByRole("img", {
      name: "whiteboardEditor:minimap.label",
    });
    const before = controller.state.viewport;
    fireEvent.pointerDown(map, {
      button: 2,
      buttons: 2,
      clientX: 10,
      clientY: 10,
    });
    expect(controller.state.viewport).toBe(before);
  });
});
