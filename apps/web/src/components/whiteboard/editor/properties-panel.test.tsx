import {
  type BoardElement,
  createElement,
  type ElementType,
  type LinearElement,
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
import { BoardController } from "./controller";
import {
  type PanelActions,
  PropertiesPanel,
  SWATCH_EDGE,
} from "./properties-panel";
import { TextOverlay } from "./text-overlay";
import type { ToolId } from "./tools";
import { EditorContext } from "./use-editor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const controllers: BoardController[] = [];

afterEach(() => {
  cleanup();
  for (const controller of controllers.splice(0)) controller.dispose();
});

const el = (type: ElementType, props: Record<string, unknown> = {}) =>
  createElement(type, props as never) as BoardElement;

function renderPanel(
  options: {
    elements?: BoardElement[];
    select?: BoardElement[];
    tool?: ToolId;
    /** Opens the text editor on this element, as a double click does. */
    edit?: { element: BoardElement; isNew?: boolean };
  } = {},
) {
  const doc = new Y.Doc();
  writeElements(
    doc,
    options.elements ??
      options.select ??
      (options.edit && !options.edit.isNew ? [options.edit.element] : []),
    "seed",
  );
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
  act(() => {
    if (options.tool) {
      const tool = options.tool;
      controller.update((state) => ({ ...state, tool }));
    }
    if (options.select)
      controller.select(options.select.map((element) => element.id));
    const edit = options.edit;
    if (edit) {
      // A new element lives only in the preview until its editor closes.
      if (edit.isNew) controller.setPreview([edit.element], { live: false });
      controller.select([edit.element.id]);
      controller.update((state) => ({
        ...state,
        editingTextId: edit.element.id,
      }));
    }
  });
  const actions: PanelActions = {
    onTurnIntoTasks: vi.fn(),
    onMakeDependency: vi.fn(),
    dependencyExists: false,
    onRemoveDependency: vi.fn(),
    onEditLink: vi.fn(),
    onEditText: vi.fn(),
    tasksEnabled: false,
  };
  const onDone = vi.fn(() =>
    controller.update((state) => ({ ...state, editingTextId: null })),
  );
  render(
    <EditorContext.Provider value={controller}>
      <PropertiesPanel actions={actions} />
      {options.edit && (
        <TextOverlay
          controller={controller}
          elementId={options.edit.element.id}
          isNew={Boolean(options.edit.isNew)}
          onDone={onDone}
        />
      )}
    </EditorContext.Provider>,
  );
  return { controller, actions, doc, onDone };
}

/** Closes the open text editor, writing what it holds. */
function closeEditor() {
  act(() => {
    fireEvent.keyDown(screen.getByTestId("whiteboard-text-editor"), {
      key: "Escape",
    });
  });
}

const pick = (name: string) =>
  act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });

/** The section headings, in the order the panel shows them. */
function sections(): string[] {
  return Array.from(document.querySelectorAll("legend")).map(
    (legend) => legend.textContent ?? "",
  );
}

const key = (name: string) => `whiteboardEditor:panel.${name}`;
const FILL = key("fill");
const FILL_STYLE = key("fillStyle");
const STROKE = key("stroke");
const TEXT_COLOR = key("textColor");
const STROKE_WIDTH = key("strokeWidth");
const STROKE_STYLE = key("strokeStyle");
const SKETCH = key("sketch");
const CORNERS = key("corners");
const FONT = key("font");
const FONT_SIZE = key("fontSize");
const ALIGN = key("align");
const ROUTING = key("routing");
const HEADS = key("arrowheads");
const OPACITY = key("opacity");
const NOTE = key("stickyColor");
const LAYERS = key("layers");
const ACTIONS = key("actions");
const PEN = "whiteboardEditor:pens.label";
const SHAPE = "whiteboardEditor:shapes.label";
const FRAME_NAME = "whiteboardEditor:text.frameName";
const IMAGE = "whiteboardEditor:crop.section";

describe("PropertiesPanel", () => {
  it.each(["select", "hand", "laser", "eraser"] as const)(
    "shows no style controls for the %s tool",
    (tool) => {
      renderPanel({ tool });
      expect(screen.queryByTestId("whiteboard-properties")).toBeNull();
    },
  );

  it("shows only line controls for the arrow tool", () => {
    renderPanel({ tool: "arrow" });
    expect(sections()).toEqual([
      STROKE,
      STROKE_WIDTH,
      STROKE_STYLE,
      SKETCH,
      ROUTING,
      HEADS,
      OPACITY,
    ]);
  });

  it("drops arrowheads for the line tool", () => {
    renderPanel({ tool: "line" });
    expect(sections()).not.toContain(HEADS);
    expect(sections()).toContain(ROUTING);
  });

  it("shows no fill or font for a selected arrow without a label", () => {
    const arrow = el("arrow");
    renderPanel({ select: [arrow] });
    const shown = sections();
    for (const hidden of [FILL, FILL_STYLE, FONT, FONT_SIZE, ALIGN, CORNERS])
      expect(shown).not.toContain(hidden);
    expect(shown).toEqual([
      STROKE,
      STROKE_WIDTH,
      STROKE_STYLE,
      SKETCH,
      ROUTING,
      HEADS,
      OPACITY,
      LAYERS,
      ACTIONS,
    ]);
  });

  it("shows the label font of a labelled arrow, without alignment", () => {
    renderPanel({ select: [el("arrow", { text: "blocks" })] });
    expect(sections()).toContain(FONT);
    expect(sections()).toContain(FONT_SIZE);
    expect(sections()).not.toContain(ALIGN);
  });

  it("shows text controls and no outline for a text", () => {
    renderPanel({ select: [el("text", { text: "hi" })] });
    expect(sections()).toEqual([
      TEXT_COLOR,
      FONT,
      FONT_SIZE,
      ALIGN,
      OPACITY,
      LAYERS,
      ACTIONS,
    ]);
  });

  it("shows the note colour and text for a sticky, never a stroke", () => {
    renderPanel({ select: [el("sticky")] });
    const shown = sections();
    expect(shown).toContain(NOTE);
    expect(shown).toContain(FONT_SIZE);
    for (const hidden of [STROKE, STROKE_WIDTH, STROKE_STYLE, FILL, SKETCH])
      expect(shown).not.toContain(hidden);
  });

  it("shows the full shape style for a rectangle, in order", () => {
    renderPanel({ select: [el("rectangle")] });
    expect(sections()).toEqual([
      SHAPE,
      STROKE,
      FILL,
      FILL_STYLE,
      STROKE_WIDTH,
      STROKE_STYLE,
      SKETCH,
      CORNERS,
      FONT,
      FONT_SIZE,
      ALIGN,
      OPACITY,
      LAYERS,
      ACTIONS,
    ]);
  });

  it("keeps sections in the same order whatever is selected", () => {
    renderPanel({ select: [el("ellipse")] });
    const ellipse = sections();
    cleanup();
    renderPanel({ select: [el("arrow", { text: "x" })] });
    const arrow = sections();
    const shared = ellipse.filter((label) => arrow.includes(label));
    expect(arrow.filter((label) => shared.includes(label))).toEqual(shared);
  });

  it("shows pen controls for the draw tool, without dashes or sketchiness", () => {
    renderPanel({ tool: "draw" });
    expect(sections()).toEqual([PEN, STROKE, STROKE_WIDTH, OPACITY]);
  });

  it("shows only the crop and opacity for an image", () => {
    renderPanel({ select: [el("image", { assetId: "asset" })] });
    expect(sections()).toEqual([OPACITY, IMAGE, LAYERS, ACTIONS]);
  });

  it("shows a frame's background and name, and renames it", () => {
    const frame = el("frame");
    const { actions } = renderPanel({ select: [frame] });
    expect(sections()).toEqual([FILL, OPACITY, FRAME_NAME, LAYERS, ACTIONS]);
    fireEvent.click(screen.getByRole("button", { name: key("renameFrame") }));
    expect(actions.onEditText).toHaveBeenCalledWith(frame.id);
  });

  it("shows only opacity for a task card", () => {
    renderPanel({ select: [el("task", { taskId: "t1" })] });
    expect(sections()).toEqual([OPACITY, LAYERS, ACTIONS]);
  });

  it("shows what a mixed selection shares", () => {
    renderPanel({ select: [el("rectangle"), el("arrow")] });
    const shown = sections();
    expect(shown).toContain(STROKE);
    expect(shown).toContain(STROKE_STYLE);
    for (const hidden of [FILL, HEADS, ROUTING, CORNERS, SHAPE, FONT])
      expect(shown).not.toContain(hidden);
  });

  it("names every colour swatch for screen readers", () => {
    renderPanel({ select: [el("rectangle")] });
    expect(
      screen.getAllByRole("button", { name: "whiteboardEditor:colors.red" })
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "whiteboardEditor:colors.none" }),
    ).toBeInTheDocument();
  });

  it("changes only what the selection supports", () => {
    const text = el("text", { text: "hi" });
    const { controller } = renderPanel({ select: [text] });
    fireEvent.click(
      screen.getByRole("button", { name: "whiteboardEditor:colors.red" }),
    );
    expect(controller.get(text.id)).toMatchObject({ strokeColor: "#dc2626" });
  });
});

describe("PropertiesPanel while words are edited", () => {
  it("shows a text's style, not only its opacity and arrangement", () => {
    renderPanel({ edit: { element: el("text", { text: "hi" }) } });
    expect(sections()).toEqual([TEXT_COLOR, FONT, FONT_SIZE, ALIGN]);
  });

  it("shows a shape label's style while it is edited", () => {
    renderPanel({ edit: { element: el("rectangle", { text: "Start" }) } });
    expect(sections()).toEqual([STROKE, FONT, FONT_SIZE, ALIGN]);
  });

  it("offers a line label its font before the first letter, without alignment", () => {
    renderPanel({ edit: { element: el("arrow", { text: "" }) } });
    expect(sections()).toEqual([STROKE, FONT, FONT_SIZE]);
  });

  it("shows a note's text style while it is written", () => {
    renderPanel({
      edit: { element: el("sticky", { text: "" }), isNew: true },
    });
    expect(sections()).toEqual([FONT, FONT_SIZE, ALIGN]);
  });

  it("offers nothing while a frame is renamed", () => {
    renderPanel({ edit: { element: el("frame", { name: "" }) } });
    expect(screen.queryByTestId("whiteboard-properties")).toBeNull();
  });

  it("keeps the editor open when the panel is pressed", () => {
    renderPanel({ edit: { element: el("text", { text: "hi" }) } });
    const panel = screen.getByTestId("whiteboard-properties");
    const swatch = screen.getByRole("button", {
      name: "whiteboardEditor:colors.red",
    });
    // A prevented press keeps the focus (and the editor) where it is.
    expect(fireEvent.mouseDown(swatch)).toBe(false);
    expect(panel).toBeInTheDocument();
  });

  it("restyles the words being edited and writes them together, in one undo step", () => {
    const rect = el("rectangle", {
      text: "Start",
      fontSize: 20,
      width: 300,
      height: 200,
    });
    const { controller, doc } = renderPanel({ edit: { element: rect } });
    pick(key("sizeHuge"));
    pick("whiteboardEditor:colors.red");
    // The field shows the new size and colour right away...
    const field = screen.getByTestId("whiteboard-text-editor");
    expect(field.style.font).toContain("40px");
    expect(sections()).toEqual([STROKE, FONT, FONT_SIZE, ALIGN]);
    // ...and nothing is written until the editor closes.
    expect(readElement(doc, rect.id)).toMatchObject({ fontSize: 20 });
    fireEvent.change(field, { target: { value: "Start now" } });
    closeEditor();
    expect(readElement(doc, rect.id)).toMatchObject({
      text: "Start now",
      fontSize: 40,
      strokeColor: "#dc2626",
    });
    act(() => controller.undo());
    expect(readElement(doc, rect.id)).toMatchObject({
      text: "Start",
      fontSize: 20,
      strokeColor: rect.strokeColor,
    });
  });

  it("writes a new text in the colour picked while typing it", () => {
    const text = el("text", { text: "", autoSize: true });
    const { controller, doc } = renderPanel({
      tool: "text",
      edit: { element: text, isNew: true },
    });
    pick("whiteboardEditor:colors.blue");
    fireEvent.change(screen.getByTestId("whiteboard-text-editor"), {
      target: { value: "Hello" },
    });
    closeEditor();
    expect(readElement(doc, text.id)).toMatchObject({
      text: "Hello",
      strokeColor: "#2563eb",
    });
    // The pick is remembered for the next text, as with a selection.
    expect(controller.state.style.strokeColor).toBe("#2563eb");
  });
});

describe("PropertiesPanel for groups and frames", () => {
  it("keeps stroke and fill for a group of rectangles", () => {
    const group = ["g1"];
    const a = el("rectangle", { groupIds: group });
    const b = el("rectangle", { groupIds: group });
    renderPanel({ select: [a, b] });
    const shown = sections();
    for (const visible of [STROKE, FILL, FILL_STYLE, STROKE_WIDTH, CORNERS])
      expect(shown).toContain(visible);
  });

  it("keeps stroke and fill for a group of mixed shapes, and only what they share otherwise", () => {
    const group = ["g1"];
    renderPanel({
      select: [
        el("rectangle", { groupIds: group }),
        el("ellipse", { groupIds: group }),
        el("shape", { shape: "star", groupIds: group }),
      ],
    });
    expect(sections()).toContain(STROKE);
    expect(sections()).toContain(FILL);
    expect(sections()).not.toContain(CORNERS);
    cleanup();
    renderPanel({
      select: [
        el("rectangle", { groupIds: group }),
        el("text", { text: "hi", groupIds: group }),
      ],
    });
    expect(sections()).toContain(STROKE);
    expect(sections()).not.toContain(FILL);
  });

  it("gives a frame a background that shows, even one stored without fill", () => {
    const frame = el("frame", { fillStyle: "none" });
    const { controller } = renderPanel({ select: [frame] });
    expect(sections()).toContain(FILL);
    expect(sections()).toContain(FRAME_NAME);
    pick("whiteboardEditor:colors.yellow");
    expect(controller.get(frame.id)).toMatchObject({
      fillColor: "#fde68a",
      fillStyle: "solid",
    });
  });
});

describe("colour swatches", () => {
  it("draw their edge from a theme token, visible in dark themes", () => {
    renderPanel({ select: [el("rectangle")] });
    const black = screen.getByRole("button", {
      name: "whiteboardEditor:colors.black",
    });
    for (const token of SWATCH_EDGE.split(" "))
      expect(black.className).toContain(token);
    expect(SWATCH_EDGE).toMatch(/dark:border-foreground\/\d+/);
    // Tokens only: no raw colour in the edge.
    expect(SWATCH_EDGE).not.toMatch(/#|rgb/);
  });
});

describe("font changes on labels", () => {
  const long = "Start here with a long label that wraps over many lines";

  it("makes a shape tall enough for its label in a bigger font, in one undo step", () => {
    const rect = el("rectangle", {
      width: 160,
      height: 120,
      fontSize: 16,
      text: long,
    });
    const arrow = el("arrow", {
      x: 80,
      y: 400,
      points: [
        [0, 0],
        [0, -200],
      ],
      endBinding: { elementId: rect.id, focus: [0.5, 1], gap: 4 },
    });
    const { controller, doc } = renderPanel({
      elements: [rect, arrow],
      select: [rect],
    });
    pick(key("sizeHuge"));
    const grown = readElement(doc, rect.id);
    expect(grown).toMatchObject({ fontSize: 40, width: 160 });
    expect(grown?.height).toBeGreaterThan(120);
    // The arrow bound to its bottom edge follows it down.
    expect(readElement(doc, arrow.id)).not.toMatchObject({
      points: (arrow as LinearElement).points,
    });
    act(() => controller.undo());
    expect(readElement(doc, rect.id)).toMatchObject({
      fontSize: 16,
      height: 120,
    });
  });

  it("grows a note for a wider font and leaves a labelled arrow's shape alone", () => {
    const note = el("sticky", {
      width: 120,
      height: 120,
      fontSize: 20,
      fontFamily: "sans",
      text: long,
    });
    const { doc } = renderPanel({ select: [note] });
    pick(key("sizeLarge"));
    expect(readElement(doc, note.id)?.height).toBeGreaterThan(120);
    cleanup();
    const arrow = el("arrow", { text: "blocks", fontSize: 16 });
    const { doc: other } = renderPanel({ select: [arrow] });
    pick(key("sizeHuge"));
    expect(readElement(other, arrow.id)).toMatchObject({
      fontSize: 40,
      height: arrow.height,
    });
  });
});
