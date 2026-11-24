import {
  type BoardElement,
  elementBounds,
  type FrameElement,
  ordersBetween,
  type StickyElement,
  topOrder,
  updateElement,
} from "@margaya/whiteboard";

// Board layout for AI proposals. Pure: the editor previews the proposal,
// and only on accept turns it into elements and writes them in one commit
// (one undo step, synced to everyone like a manual edit).

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
type Box = Point & Size;

export const NOTE_SIZE = 200;
export const NOTE_GAP = 24;
export const FRAME_PADDING = 32;
/** Room between placed blocks and what is already on the board. */
export const CLEARANCE = 48;
/** Frames side by side leave room for the title drawn above each one. */
export const FRAME_GAP = 80;

/** Columns for `count` notes: a near-square grid, at most `max` wide. */
export function columnsFor(count: number, max = 4): number {
  return Math.max(1, Math.min(max, Math.ceil(Math.sqrt(count))));
}

/** Top-left corners of a grid of cells inside a frame, and the frame size. */
export function noteGrid(
  count: number,
  maxColumns = 4,
  cell: Size = { width: NOTE_SIZE, height: NOTE_SIZE },
): { size: Size; cells: Point[] } {
  const columns = columnsFor(count, maxColumns);
  const rows = Math.max(1, Math.ceil(count / columns));
  const cells: Point[] = [];
  for (let index = 0; index < count; index++) {
    cells.push({
      x: FRAME_PADDING + (index % columns) * (cell.width + NOTE_GAP),
      y: FRAME_PADDING + Math.floor(index / columns) * (cell.height + NOTE_GAP),
    });
  }
  const span = (n: number, length: number) => n * length + (n - 1) * NOTE_GAP;
  return {
    size: {
      width: span(columns, cell.width) + 2 * FRAME_PADDING,
      height: span(rows, cell.height) + 2 * FRAME_PADDING,
    },
    cells,
  };
}

function overlaps(a: Box, b: Box, margin: number): boolean {
  return (
    a.x < b.x + b.width + margin &&
    b.x < a.x + a.width + margin &&
    a.y < b.y + b.height + margin &&
    b.y < a.y + a.height + margin
  );
}

/**
 * The top-left corner of a free box of `size` as close to `center` as a
 * search over growing rings finds; past the search, right of everything.
 */
export function findFreeSpot(
  occupied: readonly Box[],
  size: Size,
  center: Point,
  { step = 120, rings = 30 }: { step?: number; rings?: number } = {},
): Point {
  const origin = {
    x: Math.round(center.x - size.width / 2),
    y: Math.round(center.y - size.height / 2),
  };
  const free = (at: Point) =>
    !occupied.some((box) => overlaps({ ...at, ...size }, box, CLEARANCE));
  if (free(origin)) return origin;
  for (let ring = 1; ring <= rings; ring++) {
    const candidates: Point[] = [];
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        candidates.push({ x: origin.x + i * step, y: origin.y + j * step });
      }
    }
    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - origin.x, a.y - origin.y) -
        Math.hypot(b.x - origin.x, b.y - origin.y),
    );
    const found = candidates.find(free);
    if (found) return found;
  }
  const right = Math.max(...occupied.map((box) => box.x + box.width));
  return { x: Math.round(right + CLEARANCE * 2), y: origin.y };
}

/** Bounds of live elements, as the free-space search sees them. */
export function occupiedBoxes(
  elements: readonly BoardElement[],
  skip: ReadonlySet<string> = new Set(),
): Box[] {
  return elements
    .filter((element) => !element.deleted && !skip.has(element.id))
    .map(elementBounds);
}

export type MakeElement = (
  type: "sticky" | "frame",
  props: Record<string, unknown>,
) => BoardElement;

/** The size the brainstorm block takes on the board. */
export function brainstormSize(count: number): Size {
  return noteGrid(count).size;
}

/**
 * Brainstormed notes in a grid, in a titled frame when `framed`, with the
 * block's top-left corner at `at`. The frame comes first (drawn below).
 */
export function brainstormElements(
  make: MakeElement,
  input: { ideas: readonly string[]; title: string; framed: boolean },
  at: Point,
): BoardElement[] {
  const grid = noteGrid(input.ideas.length);
  const frame = input.framed
    ? (make("frame", {
        x: at.x,
        y: at.y,
        width: grid.size.width,
        height: grid.size.height,
        name: input.title,
      }) as FrameElement)
    : null;
  const notes = input.ideas.map((text, index) => {
    const cell = grid.cells[index] ?? { x: 0, y: 0 };
    return make("sticky", {
      x: at.x + cell.x,
      y: at.y + cell.y,
      width: NOTE_SIZE,
      height: NOTE_SIZE,
      text,
      frameId: frame?.id ?? null,
    });
  });
  return frame ? [frame, ...notes] : notes;
}

export type GroupPlan = {
  title: string;
  notes: readonly StickyElement[];
};

/** The largest note of a group is its grid cell: notes keep their size. */
export function cellFor(notes: readonly Size[]): Size {
  return {
    width: Math.max(NOTE_SIZE / 2, ...notes.map((note) => note.width)),
    height: Math.max(NOTE_SIZE / 2, ...notes.map((note) => note.height)),
  };
}

/** Frames side by side, top-aligned: their offsets and the total size. */
export function groupsLayout(groups: readonly (readonly Size[])[]): {
  size: Size;
  frames: (Point & { grid: ReturnType<typeof noteGrid> })[];
} {
  let x = 0;
  let height = 0;
  const frames = groups.map((notes) => {
    const grid = noteGrid(notes.length, 3, cellFor(notes));
    const frame = { x, y: 0, grid };
    x += grid.size.width + FRAME_GAP;
    height = Math.max(height, grid.size.height);
    return frame;
  });
  return { size: { width: Math.max(0, x - FRAME_GAP), height }, frames };
}

/**
 * Titled frames side by side from `at`, the notes moved into them. Order
 * keys put the frames above everything on the board and the notes above
 * the frames, so each note stays visible on its new frame.
 */
export function groupElements(
  make: MakeElement,
  groups: readonly GroupPlan[],
  all: readonly BoardElement[],
  at: Point,
  userId: string | null,
): { frames: BoardElement[]; notes: BoardElement[] } {
  const layout = groupsLayout(groups.map((group) => group.notes));
  const noteCount = groups.reduce((sum, group) => sum + group.notes.length, 0);
  const keys = ordersBetween(topOrder(all), null, groups.length + noteCount);
  let frameKey = 0;
  let noteKey = groups.length;
  const frames: BoardElement[] = [];
  const notes: BoardElement[] = [];
  groups.forEach((group, index) => {
    const place = layout.frames[index];
    if (!place) return;
    const frame = make("frame", {
      x: at.x + place.x,
      y: at.y + place.y,
      width: place.grid.size.width,
      height: place.grid.size.height,
      name: group.title,
    });
    frames.push({ ...frame, order: keys[frameKey++] ?? frame.order });
    group.notes.forEach((note, noteIndex) => {
      const cell = place.grid.cells[noteIndex] ?? { x: 0, y: 0 };
      const moved = updateElement(
        note,
        {
          x: frame.x + cell.x,
          y: frame.y + cell.y,
          angle: 0,
          frameId: frame.id,
        },
        { userId },
      );
      notes.push({ ...moved, order: keys[noteKey++] ?? moved.order });
    });
  });
  return { frames, notes };
}

/** The centre of a set of boxes (the selection a proposal came from). */
export function centreOf(boxes: readonly Box[]): Point | null {
  if (boxes.length === 0) return null;
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** Sticky notes that "Group with AI" can sort: unlocked, with text. */
export function groupableNotes(
  elements: readonly BoardElement[],
): StickyElement[] {
  return elements.filter(
    (element): element is StickyElement =>
      element.type === "sticky" &&
      !element.locked &&
      element.text.trim().length > 0,
  );
}

/** Summary text as it goes on the board: the title, a blank line, the lines. */
export function summaryText(title: string, summary: string): string {
  const head = title.trim();
  const body = summary.trim();
  return head ? `${head}\n\n${body}` : body;
}
