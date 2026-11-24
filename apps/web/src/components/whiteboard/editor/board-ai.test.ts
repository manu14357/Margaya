import {
  type BoardElement,
  compareOrder,
  createElement,
  type StickyElement,
} from "@margaya/whiteboard";
import { describe, expect, it } from "vitest";
import {
  brainstormElements,
  brainstormSize,
  CLEARANCE,
  centreOf,
  FRAME_PADDING,
  findFreeSpot,
  groupElements,
  groupsLayout,
  NOTE_SIZE,
  noteGrid,
  occupiedBoxes,
  summaryText,
} from "./board-ai";

const make = (type: "sticky" | "frame", props: Record<string, unknown>) =>
  createElement(type, props as never) as BoardElement;

describe("note grid", () => {
  it("lays notes out in a near-square grid inside the frame padding", () => {
    const grid = noteGrid(5);
    expect(grid.cells).toHaveLength(5);
    expect(grid.cells[0]).toEqual({ x: FRAME_PADDING, y: FRAME_PADDING });
    // 5 notes: 3 columns, 2 rows.
    expect(grid.cells[3]?.y).toBeGreaterThan(FRAME_PADDING);
    expect(grid.size.width).toBe(3 * NOTE_SIZE + 2 * 24 + 2 * FRAME_PADDING);
    expect(grid.size.height).toBe(2 * NOTE_SIZE + 24 + 2 * FRAME_PADDING);
  });
});

describe("free space", () => {
  it("uses the centre when nothing is in the way", () => {
    expect(
      findFreeSpot([], { width: 100, height: 100 }, { x: 0, y: 0 }),
    ).toEqual({ x: -50, y: -50 });
  });

  it("moves off the content that covers the centre, keeping clear of it", () => {
    const occupied = [{ x: -200, y: -200, width: 400, height: 400 }];
    const size = { width: 200, height: 200 };
    const spot = findFreeSpot(occupied, size, { x: 0, y: 0 });
    const box = { ...spot, ...size };
    const blocker = occupied[0];
    if (!blocker) throw new Error("no blocker");
    const apart =
      box.x >= blocker.x + blocker.width + CLEARANCE ||
      box.x + box.width + CLEARANCE <= blocker.x ||
      box.y >= blocker.y + blocker.height + CLEARANCE ||
      box.y + box.height + CLEARANCE <= blocker.y;
    expect(apart).toBe(true);
  });

  it("skips the elements being moved", () => {
    const note = createElement("sticky", { x: 0, y: 0 });
    expect(occupiedBoxes([note], new Set([note.id]))).toEqual([]);
    expect(occupiedBoxes([{ ...note, deleted: true }])).toEqual([]);
  });
});

describe("brainstorm", () => {
  it("builds a titled frame with one note per idea inside it", () => {
    const elements = brainstormElements(
      make,
      { ideas: ["One", "Two", "Three"], title: "Ideas", framed: true },
      { x: 100, y: 50 },
    );
    const [frame, ...notes] = elements;
    expect(frame).toMatchObject({
      type: "frame",
      name: "Ideas",
      x: 100,
      y: 50,
    });
    expect(notes.map((note) => note.type === "sticky" && note.text)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
    for (const note of notes) {
      expect(note.frameId).toBe(frame?.id);
      expect(note.x).toBeGreaterThanOrEqual(100);
      expect(note.x + note.width).toBeLessThanOrEqual(
        100 + brainstormSize(3).width,
      );
    }
  });

  it("leaves the frame out when asked", () => {
    const elements = brainstormElements(
      make,
      { ideas: ["One"], title: "", framed: false },
      { x: 0, y: 0 },
    );
    expect(elements.map((element) => element.type)).toEqual(["sticky"]);
    expect(elements[0]?.frameId).toBeNull();
  });
});

describe("group", () => {
  it("moves notes into titled frames, above everything else on the board", () => {
    const existing = createElement("rectangle", { order: "a5" });
    const a = createElement("sticky", { text: "A", x: 900, y: 900, angle: 1 });
    const b = createElement("sticky", { text: "B", order: "a1" });
    const c = createElement("sticky", { text: "C", width: 300, height: 260 });
    const all = [existing, a, b, c] as BoardElement[];
    const { frames, notes } = groupElements(
      make,
      [
        { title: "First", notes: [a, b] as StickyElement[] },
        { title: "Second", notes: [c] as StickyElement[] },
      ],
      all,
      { x: 0, y: 0 },
      "me",
    );
    expect(frames.map((frame) => frame.type === "frame" && frame.name)).toEqual(
      ["First", "Second"],
    );
    const [first, second] = frames;
    expect(notes.map((note) => note.frameId)).toEqual([
      first?.id,
      first?.id,
      second?.id,
    ]);
    // Same ids, edits by the caller, straightened; sizes kept.
    expect(notes.map((note) => note.id)).toEqual([a.id, b.id, c.id]);
    expect(notes[0]).toMatchObject({ angle: 0, updatedBy: "me" });
    expect(notes[2]).toMatchObject({ width: 300, height: 260 });
    // Frames sit above the board, notes above the frames.
    const top = existing.order;
    for (const frame of frames)
      expect(compareOrder(frame.order, top)).toBeGreaterThan(0);
    for (const note of notes)
      for (const frame of frames)
        expect(compareOrder(note.order, frame.order)).toBeGreaterThan(0);
    // The second frame starts right of the first one.
    expect(second?.x).toBeGreaterThan((first?.x ?? 0) + (first?.width ?? 0));
    expect(groupsLayout([[a, b], [c]]).size.width).toBe(
      (second?.x ?? 0) + (second?.width ?? 0),
    );
  });
});

describe("helpers", () => {
  it("finds the centre of boxes", () => {
    expect(centreOf([])).toBeNull();
    expect(
      centreOf([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 90, y: 40, width: 10, height: 10 },
      ]),
    ).toEqual({ x: 50, y: 25 });
  });

  it("puts the summary title on its own line", () => {
    expect(summaryText(" Plan ", "- One\n- Two ")).toBe("Plan\n\n- One\n- Two");
    expect(summaryText("", "- One")).toBe("- One");
  });
});
