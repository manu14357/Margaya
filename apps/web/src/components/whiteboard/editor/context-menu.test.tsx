import { readElements } from "@margaya/whiteboard";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { EditorContextMenu } from "./context-menu";
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

function renderMenu() {
  const doc = new Y.Doc();
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
  render(
    <EditorContext.Provider value={controller}>
      <EditorContextMenu
        controller={controller}
        actions={{
          onTurnIntoTasks: vi.fn(),
          onMakeDependency: vi.fn(),
          dependencyExists: false,
          onRemoveDependency: vi.fn(),
          onEditLink: vi.fn(),
          onCopyLink: vi.fn(),
          onOpenLink: vi.fn(),
          onEditText: vi.fn(),
          tasksEnabled: false,
          pointer: () => null,
        }}
      />
    </EditorContext.Provider>,
  );
  return { controller, doc };
}

describe("EditorContextMenu", () => {
  it("keeps the menu open while the Add shape submenu opens, and adds the shape", async () => {
    const { controller, doc } = renderMenu();
    act(() => {
      controller.update((state) => ({
        ...state,
        contextMenu: { clientX: 200, clientY: 150, targetId: null },
      }));
    });
    const menu = await screen.findByRole("menu", {
      name: "whiteboardEditor:contextMenu.label",
    });
    fireEvent.click(
      screen.getByRole("menuitem", { name: "whiteboardEditor:shapes.add" }),
    );
    const triangle = await screen.findByRole("menuitem", {
      name: "whiteboardEditor:shapes.names.triangle",
    });
    // The submenu opening must not read as a sibling menu and close its parent.
    expect(menu).toBeInTheDocument();
    expect(controller.state.contextMenu).not.toBeNull();

    fireEvent.click(triangle);
    expect(controller.state.contextMenu).toBeNull();
    expect(readElements(doc)).toMatchObject([
      { type: "shape", shape: "triangle" },
    ]);
  });
});
