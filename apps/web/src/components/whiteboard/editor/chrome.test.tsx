import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { BottomBar } from "./chrome";
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
