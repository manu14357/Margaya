import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { BackgroundSettings } from "./background-control";
import { BoardController } from "./controller";
import { EditorContext } from "./use-editor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const controllers: BoardController[] = [];

afterEach(() => {
  cleanup();
  for (const controller of controllers.splice(0)) controller.dispose();
});

function renderSettings() {
  const controller = new BoardController({
    doc: new Y.Doc(),
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
  render(
    <EditorContext.Provider value={controller}>
      <BackgroundSettings />
    </EditorContext.Provider>,
  );
  return controller;
}

describe("BackgroundSettings", () => {
  it("names the spacing slider itself, not only its group", () => {
    const controller = renderSettings();
    fireEvent.click(
      screen.getByRole("button", { name: "whiteboardEditor:background.grid" }),
    );
    expect(controller.settings.pattern).toBe("grid");

    // Screen readers land on the slider's input: it must carry the name. The
    // thumb stays hidden until it is measured, which jsdom never does, so
    // check the label it points at rather than the computed name.
    const slider = screen.getByRole("slider", { hidden: true });
    const labelId = slider.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId ?? "")).toHaveTextContent(
      "whiteboardEditor:background.spacing",
    );
    fireEvent.keyDown(slider, { key: "End" });
    expect(controller.settings.patternSize).toBe(40);
  });
});
