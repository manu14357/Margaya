import {
  createElement,
  readElements,
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

function renderMenu(
  extra: { onAiGroup?: () => void; onAiSummarize?: () => void } = {},
) {
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
          ...extra,
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

  it("offers neither Edit text nor Cut for a locked element", async () => {
    const { controller, doc } = renderMenu();
    const shape = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      text: "Fixed",
      locked: true,
    } as never);
    writeElements(doc, [shape], "seed");
    act(() => {
      controller.select([shape.id]);
      controller.update((state) => ({
        ...state,
        contextMenu: { clientX: 20, clientY: 20, targetId: shape.id },
      }));
    });
    await screen.findByRole("menu", {
      name: "whiteboardEditor:contextMenu.label",
    });
    expect(
      screen.queryByRole("menuitem", {
        name: /whiteboardEditor:commands\.editText/,
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", {
        name: /whiteboardEditor:commands\.cut/,
      }),
    ).toBeNull();
    expect(
      screen.getByRole("menuitem", {
        name: /^whiteboardEditor:commands\.copy(?!Style)/,
      }),
    ).toBeInTheDocument();
  });

  it("offers the AI actions for selected notes where AI is available", async () => {
    const onAiGroup = vi.fn();
    const onAiSummarize = vi.fn();
    const { controller, doc } = renderMenu({ onAiGroup, onAiSummarize });
    const a = createElement("sticky", { x: 0, y: 0, text: "One" });
    const b = createElement("sticky", { x: 300, y: 0, text: "Two" });
    writeElements(doc, [a, b], "seed");
    act(() => {
      controller.select([a.id, b.id]);
      controller.update((state) => ({
        ...state,
        contextMenu: { clientX: 20, clientY: 20, targetId: a.id },
      }));
    });
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "whiteboardEditor:ai.group",
      }),
    );
    expect(onAiGroup).toHaveBeenCalled();
    expect(controller.state.contextMenu).toBeNull();

    act(() => {
      controller.select([a.id]);
      controller.update((state) => ({
        ...state,
        contextMenu: { clientX: 20, clientY: 20, targetId: a.id },
      }));
    });
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "whiteboardEditor:ai.summarizeSelection",
      }),
    );
    expect(onAiSummarize).toHaveBeenCalled();
    // One note can't be grouped.
    expect(
      screen.queryByRole("menuitem", { name: "whiteboardEditor:ai.group" }),
    ).toBeNull();
  });

  it("offers no AI actions where AI is not available", async () => {
    const { controller, doc } = renderMenu();
    const a = createElement("sticky", { text: "One" });
    const b = createElement("sticky", { text: "Two" });
    writeElements(doc, [a, b], "seed");
    act(() => {
      controller.select([a.id, b.id]);
      controller.update((state) => ({
        ...state,
        contextMenu: { clientX: 20, clientY: 20, targetId: a.id },
      }));
    });
    await screen.findByRole("menu", {
      name: "whiteboardEditor:contextMenu.label",
    });
    expect(
      screen.queryByRole("menuitem", { name: /^whiteboardEditor:ai/ }),
    ).toBeNull();
  });
});
