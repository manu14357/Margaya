import type { APIRequestContext, Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { authFile } from "../../../helpers/auth";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { createApiContext, readJson } from "../../../helpers/http";
import {
  createProject,
  deleteProject,
  type TestProject,
} from "../../../helpers/task-data";
import { uniqueName } from "../../../helpers/ui";
import { expect, projectPath } from "./_support";

// Transforms, groups and zoom on the whiteboard canvas, driven with the mouse,
// the keyboard, wheel events and touch: scaling a grouped drawing like a
// picture, side stretches, Shift and Alt, one undo step, what a second user
// sees, nested groups, copies, bound arrows, rotation, snapping, zooming at
// the cursor, pinches, and handles lining up at every zoom and pixel ratio.
// Every test works in a project this file creates.

type Element = Record<string, unknown> & {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeWidth: number;
  groupIds: string[];
};
type Board = { id: string; title: string };
type Box = { x: number; y: number; width: number; height: number };

let project: TestProject;

test.describe.configure({ mode: "serial" });

function ownerApi() {
  return createApiContext({
    apiURL: E2E_API_URL,
    clientURL: E2E_WEB_URL,
    storageState: authFile("owner"),
  });
}

test.beforeAll(async () => {
  const api = await ownerApi();
  project = await createProject(api, { name: uniqueName("Board transforms") });
  await api.dispose();
});

test.afterAll(async () => {
  const api = await ownerApi();
  if (project) await deleteProject(api, project.id);
  await api.dispose();
});

function boardPath(boardId: string): string {
  return `${projectPath(project.id, "whiteboards")}/${boardId}`;
}

async function createBoard(
  api: APIRequestContext,
  elements?: Record<string, unknown>[],
): Promise<Board> {
  return readJson<Board>(
    await api.post("/api/whiteboard", {
      data: { projectId: project.id, title: uniqueName("Board"), elements },
    }),
    "create whiteboard",
  );
}

async function elementsOf(
  api: APIRequestContext,
  boardId: string,
): Promise<Element[]> {
  const body = await readJson<{ elements: Element[] }>(
    await api.get(`/api/whiteboard/${boardId}/content`),
    "whiteboard content",
  );
  return body.elements;
}

function byId(list: Element[], id: string): Element {
  const found = list.find((element) => element.id === id);
  if (!found) throw new Error(`element ${id} is missing`);
  return found;
}

async function openBoard(page: Page, boardId: string) {
  await page.goto(boardPath(boardId));
  const canvas = page.getByRole("application", { name: "Whiteboard canvas" });
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the whiteboard canvas has no box");
  const at = (dx: number, dy: number): [number, number] => [
    box.x + dx,
    box.y + dy,
  ];
  return { canvas, box, at };
}

function tool(page: Page, name: string) {
  return page
    .getByRole("toolbar", { name: "Tools" })
    .getByRole("button", { name, exact: true });
}

async function drag(
  page: Page,
  from: [number, number],
  to: [number, number],
  options: { keys?: string[]; steps?: number } = {},
) {
  for (const key of options.keys ?? []) await page.keyboard.down(key);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: options.steps ?? 12 });
  await page.mouse.up();
  for (const key of options.keys ?? []) await page.keyboard.up(key);
}

/** The static board layer as a PNG data URL. */
function boardPixels(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "[role='application'] canvas",
    );
    return canvas?.toDataURL("image/png") ?? "";
  });
}

/** Page box (CSS pixels) of the board pixels close to `rgb`. */
function colourBox(page: Page, rgb: [number, number, number]) {
  return page.evaluate((rgb) => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "[role='application'] canvas",
    );
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if (
          Math.abs((data[i] ?? 0) - rgb[0]) <= 30 &&
          Math.abs((data[i + 1] ?? 0) - rgb[1]) <= 30 &&
          Math.abs((data[i + 2] ?? 0) - rgb[2]) <= 30
        ) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX < 0) return null;
    const rect = canvas.getBoundingClientRect();
    const ratio = width / rect.width;
    return {
      x: rect.left + minX / ratio,
      y: rect.top + minY / ratio,
      width: (maxX - minX + 1) / ratio,
      height: (maxY - minY + 1) / ratio,
      ratio,
      backing: [width, height, rect.width, rect.height],
    };
  }, rgb);
}

// A filled, crisp 100 x 100 square in a colour nothing else uses: where it
// lands on screen gives the board-to-page mapping of the current view.
const MARKER_RGB: [number, number, number] = [224, 49, 49];
const marker = (x: number, y: number) => ({
  id: "marker",
  type: "rectangle",
  x,
  y,
  width: 100,
  height: 100,
  fillColor: "#e03131",
  strokeColor: "#e03131",
  fillStyle: "solid",
  strokeWidth: 1,
  sketch: 0,
});

/**
 * The board-to-page mapping of the current view, read from where the marker
 * square is drawn. Without a known zoom the view is first reset to 100%, so
 * only the offset is measured.
 */
async function viewOf(
  page: Page,
  markerAt: { x: number; y: number },
  knownZoom?: number,
) {
  if (knownZoom === undefined && (await zoomPercent(page)) !== 100) {
    await page
      .getByRole("button", { name: /^Zoom \d+%, reset to 100%$/ })
      .click();
    await expect.poll(() => zoomPercent(page)).toBe(100);
  }
  const zoom = knownZoom ?? 1;
  let found: Awaited<ReturnType<typeof colourBox>> = null;
  await expect
    .poll(async () => {
      found = await colourBox(page, MARKER_RGB);
      // Drawn 101 units wide: 100 plus half its 1-unit stroke on each side.
      return found ? Math.abs(found.width - 101 * zoom) <= 2 : false;
    })
    .toBe(true);
  const box = found as unknown as Box;
  const left = box.x + 0.5 * zoom;
  const top = box.y + 0.5 * zoom;
  return {
    zoom,
    toPage: (x: number, y: number): [number, number] => [
      left + (x - markerAt.x) * zoom,
      top + (y - markerAt.y) * zoom,
    ],
  };
}

function wheel(
  page: Page,
  at: [number, number],
  deltaY: number,
  options: { ctrlKey?: boolean; shiftKey?: boolean } = {},
) {
  return page.evaluate(
    ({ at, deltaY, options }) => {
      document.elementFromPoint(at[0], at[1])?.dispatchEvent(
        new WheelEvent("wheel", {
          clientX: at[0],
          clientY: at[1],
          deltaY,
          ctrlKey: Boolean(options.ctrlKey),
          shiftKey: Boolean(options.shiftKey),
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { at, deltaY, options },
  );
}

/** Waits for the canvas to paint the latest view. */
function nextFrame(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/**
 * Centre of the selection's bottom-right handle. Handles and the frame are
 * the only fully opaque marks on the interactive layer (outlines are drawn
 * see-through), and that handle is the lowest, right-most of them.
 */
async function bottomRightHandle(page: Page): Promise<[number, number]> {
  await nextFrame(page);
  const corner = await page.evaluate(() => {
    const overlay = document.querySelectorAll<HTMLCanvasElement>(
      "[role='application'] canvas",
    )[1];
    const ctx = overlay?.getContext("2d");
    if (!overlay || !ctx) return null;
    const { width, height } = overlay;
    const data = ctx.getImageData(0, 0, width, height).data;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if ((data[(y * width + x) * 4 + 3] ?? 0) > 240) {
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    const rect = overlay.getBoundingClientRect();
    const ratio = width / rect.width;
    return maxX < 0
      ? null
      : [rect.left + maxX / ratio, rect.top + maxY / ratio];
  });
  if (!corner) throw new Error("no selection handles on screen");
  // The handle is 9 pixels wide with a 1.5 pixel border.
  return [(corner[0] ?? 0) - 5, (corner[1] ?? 0) - 5];
}

async function zoomPercent(page: Page): Promise<number> {
  const label = await page
    .getByRole("button", { name: /^Zoom \d+%, reset to 100%$/ })
    .getAttribute("aria-label");
  return Number(/(\d+)%/.exec(label ?? "")?.[1]);
}

/** Union of the elements' boxes (unrotated elements only). */
function unionOf(list: Element[]): Box {
  const left = Math.min(...list.map((e) => e.x));
  const top = Math.min(...list.map((e) => e.y));
  const right = Math.max(...list.map((e) => e.x + e.width));
  const bottom = Math.max(...list.map((e) => e.y + e.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Records page errors and console errors a test can assert on. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/WebSocket is closed before the connection/.test(text)) return;
    if (/willReadFrequently/.test(text)) return;
    if (message.type() === "error") problems.push(`[error] ${text}`);
  });
  page.on("pageerror", (error) => problems.push(`[pageerror] ${error}`));
  return problems;
}

let consoleProblems: string[] = [];
test.beforeEach(({ page }) => {
  consoleProblems = watchConsole(page);
});
test.afterEach(() => {
  expect(consoleProblems).toEqual([]);
});

// A grouped heart with highlighter strokes and pen dots, seeded.
function heartScene(groupId = "heart") {
  const wave = Array.from({ length: 21 }, (_, i) => [
    i * 6,
    Math.sin(i / 2) * 6 + 6,
  ]);
  const g = [groupId];
  return [
    { ...marker(500, 0), order: "a0" },
    {
      id: "heart",
      order: "a1",
      type: "shape",
      shape: "heart",
      x: 700,
      y: 250,
      width: 160,
      height: 140,
      fillColor: "#ffc9c9",
      fillStyle: "solid",
      groupIds: g,
    },
    {
      id: "band",
      order: "a2",
      type: "draw",
      x: 720,
      y: 300,
      width: 120,
      height: 12,
      points: wave,
      penStyle: "highlighter",
      strokeColor: "#f59f00",
      strokeWidth: 4,
      groupIds: g,
    },
    {
      id: "dot",
      order: "a3",
      type: "draw",
      x: 760,
      y: 280,
      width: 0.5,
      height: 0.5,
      points: [
        [0, 0],
        [0.5, 0.5],
      ],
      strokeWidth: 2,
      groupIds: g,
    },
  ];
}

test("the user's heart: a grouped drawing scales like a picture, in one undo step, for everyone", async ({
  page,
  api,
  pageAs,
}) => {
  const board = await createBoard(api);
  // A second user watches the same empty board, so both views start alike.
  const peer = await pageAs("admin");
  const peerProblems = watchConsole(peer);
  await peer.setViewportSize(
    page.viewportSize() ?? { width: 1280, height: 720 },
  );
  const peerView = await openBoard(peer, board.id);
  // Scrolling away and back keeps the peer's view where it is when the
  // drawing arrives (a board that receives its first content zooms to it).
  await wheel(peer, peerView.at(400, 300), 100);
  await wheel(peer, peerView.at(400, 300), -100);
  const { at, canvas } = await openBoard(page, board.id);

  // A filled heart from the shape library.
  await page.getByRole("button", { name: "Shape library" }).click();
  const search = page.getByRole("searchbox", { name: "Search shapes" });
  await search.fill("heart");
  await search.press("Enter");
  await drag(page, at(300, 250), at(460, 390));
  const style = page.getByRole("region", { name: "Style" });
  await style
    .getByRole("group", { name: "Background" })
    .getByRole("button", { name: "Red" })
    .click();
  await page.keyboard.press("Escape");

  // Two highlighter strokes across it.
  await tool(page, "Pen").click();
  await style.getByRole("button", { name: "Highlighter" }).click();
  for (const y of [300, 340]) {
    await page.mouse.move(...at(320, y));
    await page.mouse.down();
    for (let i = 1; i <= 20; i += 1) {
      await page.mouse.move(...at(320 + i * 6, y + Math.sin(i / 2) * 6));
    }
    await page.mouse.up();
  }
  // Three single-tap dots with the pen.
  await style.getByRole("button", { name: "Pen", exact: true }).click();
  for (const [x, y] of [
    [350, 280],
    [380, 290],
    [410, 280],
  ] as const) {
    await page.mouse.click(...at(x, y));
    await page.waitForTimeout(450);
  }
  await tool(page, "Select").click();
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+g");
  await expect
    .poll(async () => {
      const list = await elementsOf(api, board.id);
      return list.length === 6 && new Set(list.map((e) => e.groupIds[0])).size;
    })
    .toBe(1);
  const before = await elementsOf(api, board.id);
  const box = unionOf(before);

  // Drag the bottom-right corner to three times the size, deliberately not
  // along the diagonal: a group still scales evenly, like a picture.
  const handle = at(box.x + box.width + 4, box.y + box.height + 4);
  await page.mouse.move(...handle);
  await page.mouse.down();
  await page.mouse.move(
    ...at(box.x + box.width * 3 + 4, box.y + box.height * 2.4),
    { steps: 20 },
  );
  await page.waitForTimeout(200);
  const preview = await boardPixels(page);
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        byId(await elementsOf(api, board.id), before[0]?.id ?? "").width,
    )
    .toBeCloseTo((before[0]?.width ?? 0) * 3, 0);
  // Nothing jumps on release.
  expect(await boardPixels(page)).toBe(preview);

  const after = await elementsOf(api, board.id);
  for (const original of before) {
    const scaled = byId(after, original.id);
    // Every part grows threefold from the fixed top-left corner...
    expect(scaled.x - box.x).toBeCloseTo((original.x - box.x) * 3, 0);
    expect(scaled.y - box.y).toBeCloseTo((original.y - box.y) * 3, 0);
    expect(scaled.width).toBeCloseTo(original.width * 3, 0);
    expect(scaled.height).toBeCloseTo(original.height * 3, 0);
    // ...and so do the outline, the highlighter and the dots.
    expect(scaled.strokeWidth).toBeCloseTo(original.strokeWidth * 3, 5);
  }

  // The second user sees exactly the same picture.
  await expect.poll(() => boardPixels(peer)).toBe(await boardPixels(page));

  // One undo puts everything back; redo brings the whole resize back.
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () =>
      (await elementsOf(api, board.id)).every((element) => {
        const original = byId(before, element.id);
        return (
          Math.abs(original.width - element.width) < 1e-6 &&
          original.strokeWidth === element.strokeWidth
        );
      }),
    )
    .toBe(true);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect
    .poll(async () =>
      (await elementsOf(api, board.id)).every(
        (element) =>
          Math.abs(byId(after, element.id).width - element.width) < 1e-6,
      ),
    )
    .toBe(true);
  expect(peerProblems).toEqual([]);
});

test("side handles stretch, Shift keeps the shape, Alt scales from the centre", async ({
  page,
  api,
}) => {
  const board = await createBoard(api, heartScene());
  await openBoard(page, board.id);
  const view = await viewOf(page, { x: 500, y: 0 });
  const P = view.toPage;
  const pad = 4 / view.zoom;
  const before = await elementsOf(api, board.id);
  const parts = before.filter((e) => e.id !== "marker");
  const box = unionOf(parts);
  const heart = byId(before, "heart");
  const select = () => page.mouse.click(...P(780, 360));
  const undo = async () => {
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => byId(await elementsOf(api, board.id), "heart").width)
      .toBe(heart.width);
  };

  // The right side only stretches: no thicker lines, the same height.
  await select();
  const right = box.x + box.width + pad;
  const middle = box.y + box.height / 2;
  await drag(page, P(right, middle), P(right + box.width, middle));
  await expect
    .poll(async () => byId(await elementsOf(api, board.id), "heart").width)
    .toBeCloseTo(heart.width * 2, 0);
  let list = await elementsOf(api, board.id);
  expect(byId(list, "heart").height).toBeCloseTo(heart.height, 5);
  expect(byId(list, "band").strokeWidth).toBe(4);
  expect(byId(list, "dot").strokeWidth).toBe(2);
  await undo();

  // Shift on a side keeps the proportions.
  await select();
  await drag(page, P(right, middle), P(right + box.width, middle), {
    keys: ["Shift"],
  });
  await expect
    .poll(async () => byId(await elementsOf(api, board.id), "heart").height)
    .toBeCloseTo(heart.height * 2, 0);
  await undo();

  // Alt grows from the centre: the centre stays put.
  await select();
  const corner = P(box.x + box.width + pad, box.y + box.height + pad);
  await drag(
    page,
    corner,
    [
      corner[0] + (box.width / 2) * view.zoom,
      corner[1] + (box.height / 2) * view.zoom,
    ],
    { keys: ["Alt"] },
  );
  await expect
    .poll(async () => byId(await elementsOf(api, board.id), "heart").width)
    .toBeCloseTo(heart.width * 2, 0);
  list = await elementsOf(api, board.id);
  const grown = byId(list, "heart");
  expect(grown.x + grown.width / 2).toBeCloseTo(heart.x + heart.width / 2, 0);
  expect(grown.y + grown.height / 2).toBeCloseTo(heart.y + heart.height / 2, 0);
});

test("groups: nesting, entering, copies with new ids, bound arrows and frames", async ({
  page,
  api,
}) => {
  const filled = { fillColor: "#a5d8ff", fillStyle: "solid" };
  const board = await createBoard(api, [
    marker(530, 200),
    {
      id: "a",
      type: "rectangle",
      x: 700,
      y: 100,
      width: 100,
      height: 80,
      groupIds: ["outer", "inner"],
      ...filled,
    },
    {
      id: "b",
      type: "ellipse",
      x: 850,
      y: 100,
      width: 100,
      height: 80,
      groupIds: ["outer", "inner"],
      ...filled,
    },
    {
      id: "c",
      type: "rectangle",
      x: 1000,
      y: 100,
      width: 100,
      height: 80,
      groupIds: ["outer"],
      ...filled,
    },
    {
      id: "e",
      type: "rectangle",
      x: 700,
      y: 350,
      width: 100,
      height: 80,
      ...filled,
    },
    {
      id: "arrow",
      type: "arrow",
      x: 750,
      y: 344,
      points: [
        [0, 0],
        [0, -158],
      ],
      startBinding: { elementId: "e", focus: [0.5, 0.5], gap: 6 },
      endBinding: { elementId: "a", focus: [0.5, 0.5], gap: 6 },
    },
  ]);
  const { canvas } = await openBoard(page, board.id);
  const view = await viewOf(page, { x: 530, y: 200 });
  const P = view.toPage;
  const list = () => elementsOf(api, board.id);
  const arrowEnd = (all: Element[]) => {
    const arrow = byId(all, "arrow") as Element & { points: number[][] };
    const last = arrow.points[arrow.points.length - 1] ?? [0, 0];
    return { x: arrow.x + (last[0] ?? 0), y: arrow.y + (last[1] ?? 0) };
  };

  // Clicking any member picks the whole outer group; the bound arrow follows
  // the move and stays bound.
  await drag(page, P(750, 140), P(800, 140));
  await expect.poll(async () => byId(await list(), "c").x).toBe(1050);
  let all = await list();
  expect(byId(all, "a").x).toBe(750);
  // Its end sits just under the moved shape.
  const moved = arrowEnd(all);
  expect(moved.x).toBeGreaterThan(750);
  expect(moved.x).toBeLessThan(850);
  expect(moved.y).toBeGreaterThan(180);
  expect(moved.y).toBeLessThan(188);
  expect(byId(all, "arrow")).toMatchObject({
    startBinding: expect.objectContaining({ elementId: "e" }),
    endBinding: expect.objectContaining({ elementId: "a" }),
  });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => byId(await list(), "c").x).toBe(1000);

  // A double click enters the group: the next drag moves only the inner one.
  await page.keyboard.press("Escape");
  await page.mouse.dblclick(...P(750, 140));
  await drag(page, P(760, 140), P(760, 200));
  await expect.poll(async () => byId(await list(), "a").y).toBe(160);
  all = await list();
  expect(byId(all, "b").y).toBe(160);
  expect(byId(all, "c").y).toBe(100);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => byId(await list(), "a").y).toBe(100);
  await page.keyboard.press("Escape");

  // Resizing the group drags the arrow's bound end along.
  await page.mouse.click(...P(1050, 140));
  await drag(page, P(1104, 184), P(1204, 214));
  await expect.poll(async () => byId(await list(), "a").height).not.toBe(80);
  all = await list();
  const a = byId(all, "a");
  expect(arrowEnd(all).y).toBeCloseTo(a.y + a.height + 6, 0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => byId(await list(), "a").height).toBe(80);

  // Ungroup peels off one level.
  await page.mouse.click(...P(1050, 140));
  await page.keyboard.press("ControlOrMeta+Shift+g");
  await expect
    .poll(async () => byId(await list(), "c").groupIds.length)
    .toBe(0);
  all = await list();
  expect(byId(all, "a").groupIds).toEqual(["inner"]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => byId(await list(), "c").groupIds.length)
    .toBe(1);
  await page.keyboard.press("Escape");

  // Copy and paste, then duplicate: fresh group ids every time, nesting kept.
  // Pause first so this click does not pair with the last one into a
  // double click, which would enter the group.
  await page.waitForTimeout(500);
  await page.mouse.click(...P(1050, 140));
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(async () => (await list()).length).toBe(9);
  await page.keyboard.press("ControlOrMeta+d");
  await expect.poll(async () => (await list()).length).toBe(12);
  all = await list();
  const copies = all.filter(
    (e) => !["marker", "a", "b", "c", "e", "arrow"].includes(e.id),
  );
  const outerIds = new Set(copies.map((e) => e.groupIds[0]));
  expect(outerIds.size).toBe(2);
  expect(outerIds.has("outer")).toBe(false);
  for (const copy of copies) {
    expect(copy.groupIds).not.toContain("inner");
  }
  expect(copies.filter((e) => e.groupIds.length === 2)).toHaveLength(4);

  // Deleting a group removes all of its members.
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await list()).length).toBe(9);
});

test("rotating a group, then resizing it, keeps every part in place", async ({
  page,
  api,
}) => {
  const board = await createBoard(api, heartScene());
  await openBoard(page, board.id);
  const view = await viewOf(page, { x: 500, y: 0 });
  const P = view.toPage;
  const z = view.zoom;
  const before = await elementsOf(api, board.id);
  const parts = before.filter((e) => e.id !== "marker");
  const box = unionOf(parts);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(...P(780, 360));

  // Shift snaps a 47 degree turn to 45.
  const handle: [number, number] = [cx, box.y - 4 / z - 22 / z];
  const radius = cy - handle[1];
  const turn = (47 * Math.PI) / 180;
  await drag(
    page,
    P(...handle),
    P(cx + Math.sin(turn) * radius, cy - Math.cos(turn) * radius),
    { keys: ["Shift"] },
  );
  await expect
    .poll(async () => byId(await elementsOf(api, board.id), "heart").angle)
    .toBeCloseTo(Math.PI / 4, 5);
  const turned = await elementsOf(api, board.id);
  const heart = byId(turned, "heart");
  const original = byId(before, "heart");
  // Each part turned about the group's centre.
  const offset = {
    x: original.x + original.width / 2 - cx,
    y: original.y + original.height / 2 - cy,
  };
  const c = Math.cos(Math.PI / 4);
  const s = Math.sin(Math.PI / 4);
  expect(heart.x + heart.width / 2).toBeCloseTo(
    cx + offset.x * c - offset.y * s,
    1,
  );
  expect(heart.y + heart.height / 2).toBeCloseTo(
    cy + offset.x * s + offset.y * c,
    1,
  );

  // Grow the turned group from a corner and shrink it back: an even scale,
  // no shear and no drift.
  // The bottom-right handle, read off the screen: the frame hugs the turned
  // outlines, which the stored boxes alone do not describe.
  const start = await bottomRightHandle(page);
  await drag(page, start, [start[0] + 80 * z, start[1] + 20 * z]);
  await expect
    .poll(async () => byId(await elementsOf(api, board.id), "heart").width)
    .not.toBeCloseTo(heart.width, 1);
  const grown = byId(await elementsOf(api, board.id), "heart");
  expect(grown.angle).toBeCloseTo(heart.angle, 5);
  expect(grown.width / heart.width).toBeCloseTo(grown.height / heart.height, 3);
  await drag(page, await bottomRightHandle(page), start);
  await expect
    .poll(async () => byId(await elementsOf(api, board.id), "heart").width)
    .toBeCloseTo(heart.width, 1);
  const back = byId(await elementsOf(api, board.id), "heart");
  expect(back.x).toBeCloseTo(heart.x, 1);
  expect(back.y).toBeCloseTo(heart.y, 1);

  // Flipping the group mirrors the turn.
  await page.keyboard.press("Shift+h");
  await expect
    .poll(async () => byId(await elementsOf(api, board.id), "heart").angle)
    .toBeCloseTo(2 * Math.PI - Math.PI / 4, 3);
});

test("a click on a highlighter's visible ink selects it", async ({
  page,
  api,
}) => {
  const board = await createBoard(api, [
    marker(0, 0),
    {
      id: "band",
      type: "draw",
      x: 300,
      y: 300,
      points: [
        [0, 0],
        [200, 0],
      ],
      penStyle: "highlighter",
      strokeWidth: 4,
    },
  ]);
  await openBoard(page, board.id);
  const view = await viewOf(page, { x: 0, y: 0 });
  // 12 units off the centre line: inside the wide band of ink, far beyond
  // half the stroke width.
  await page.mouse.click(...view.toPage(400, 312));
  await page.keyboard.press("Delete");
  await expect
    .poll(async () => (await elementsOf(api, board.id)).map((e) => e.id))
    .toEqual(["marker"]);
});

test("snapping while resizing and moving a group", async ({ page, api }) => {
  const filled = { fillColor: "#a5d8ff", fillStyle: "solid" };
  const board = await createBoard(api, [
    marker(450, 300),
    {
      id: "a",
      type: "rectangle",
      x: 600,
      y: 200,
      width: 100,
      height: 80,
      groupIds: ["g"],
      ...filled,
    },
    {
      id: "b",
      type: "rectangle",
      x: 720,
      y: 230,
      width: 60,
      height: 50,
      groupIds: ["g"],
      ...filled,
    },
    {
      id: "target",
      type: "rectangle",
      x: 600,
      y: 450,
      width: 200,
      height: 60,
      fillColor: "#ffec99",
      fillStyle: "solid",
    },
  ]);
  const { canvas } = await openBoard(page, board.id);
  const view = await viewOf(page, { x: 450, y: 300 });
  const P = view.toPage;
  const z = view.zoom;
  const list = () => elementsOf(api, board.id);

  // Moving: the group's left edge snaps to the target's.
  await drag(page, P(650, 240), P(653, 360), { steps: 10 });
  await expect.poll(async () => byId(await list(), "a").y).toBe(320);
  expect(byId(await list(), "a").x).toBe(600);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => byId(await list(), "a").y).toBe(200);

  // Resizing from the right side: the edge snaps to the target's right
  // edge (800) and only the width changes.
  await page.mouse.click(...P(650, 240));
  const side = 240 + 4 / z;
  await drag(page, P(780 + 4 / z, side), P(803 + 4 / z, side + 10), {
    steps: 10,
  });
  await expect
    .poll(async () => {
      const b = byId(await list(), "b");
      return b.x + b.width;
    })
    .toBeCloseTo(800, 3);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => byId(await list(), "b").width).toBe(60);

  // With the grid on, the dragged edges land on it, not the pointer that
  // holds the handle a few pixels outside them.
  await canvas.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+Quote");
  await page.mouse.click(...P(650, 480));
  await drag(page, P(800 + 4 / z, 510 + 4 / z), P(833 + 4 / z, 537 + 4 / z), {
    steps: 10,
  });
  await expect
    .poll(async () => byId(await list(), "target").width)
    .not.toBe(200);
  const target = byId(await list(), "target");
  expect(target.width).toBe(240);
  expect(target.height).toBe(90);
});

test("zoom: at the cursor, smooth pinches, panning wheels, buttons, fit and limits", async ({
  page,
  api,
}) => {
  const board = await createBoard(api, [
    marker(0, 0),
    {
      id: "blue",
      type: "rectangle",
      x: 400,
      y: 300,
      width: 100,
      height: 100,
      fillColor: "#1c7ed6",
      strokeColor: "#1c7ed6",
      fillStyle: "solid",
      sketch: 0,
    },
  ]);
  const { box, canvas } = await openBoard(page, board.id);
  const blue: [number, number, number] = [28, 126, 214];
  // Wait for the first paint.
  await expect
    .poll(async () => (await colourBox(page, blue)) !== null)
    .toBe(true);
  const before = await colourBox(page, blue);
  if (!before) throw new Error("no blue square");

  // One ctrl+wheel notch zooms about 20% around the cursor.
  const anchor: [number, number] = [before.x + 20, before.y + 30];
  await wheel(page, anchor, -100, { ctrlKey: true });
  await expect.poll(() => zoomPercent(page)).toBe(120);
  await nextFrame(page);
  const after = await colourBox(page, blue);
  if (!after) throw new Error("no blue square");
  const fx = (anchor[0] - before.x) / before.width;
  const fy = (anchor[1] - before.y) / before.height;
  expect(after.x + fx * after.width).toBeCloseTo(anchor[0], 0);
  expect(after.y + fy * after.height).toBeCloseTo(anchor[1], 0);

  // A pinch arrives as small ctrl+wheel deltas: every step is small.
  let width = after.width;
  for (let i = 0; i < 10; i += 1) {
    await wheel(page, anchor, -3, { ctrlKey: true });
    let next = width;
    await expect
      .poll(async () => {
        next = (await colourBox(page, blue))?.width ?? 0;
        return next;
      })
      .not.toBe(width);
    expect(next / width).toBeGreaterThan(1);
    expect(next / width).toBeLessThan(1.05);
    width = next;
  }

  // Plain wheels pan; Shift turns them sideways.
  const panStart = await colourBox(page, blue);
  await wheel(page, anchor, 100);
  await nextFrame(page);
  const panned = await colourBox(page, blue);
  expect((panned?.y ?? 0) - (panStart?.y ?? 0)).toBeCloseTo(-100, 0);
  await wheel(page, anchor, 100, { shiftKey: true });
  await nextFrame(page);
  const sideways = await colourBox(page, blue);
  expect((sideways?.x ?? 0) - (panned?.x ?? 0)).toBeCloseTo(-100, 0);

  // The buttons step, the percentage resets.
  await page
    .getByRole("button", { name: /^Zoom \d+%, reset to 100%$/ })
    .click();
  await expect.poll(() => zoomPercent(page)).toBe(100);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect.poll(() => zoomPercent(page)).toBe(110);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect.poll(() => zoomPercent(page)).toBe(90);

  // Shift+1 shows everything, Shift+2 zooms to the selection.
  await canvas.focus();
  await page.keyboard.press("Shift+1");
  await expect.poll(() => zoomPercent(page)).toBe(100);
  await nextFrame(page);
  const fitted = await colourBox(page, blue);
  if (!fitted) throw new Error("no blue square");
  await page.mouse.click(fitted.x + 50, fitted.y + 50);
  await page.keyboard.press("Shift+2");
  await expect.poll(() => zoomPercent(page)).toBe(400);
  await nextFrame(page);
  const focused = await colourBox(page, blue);
  expect((focused?.x ?? 0) + (focused?.width ?? 0) / 2).toBeCloseTo(
    box.x + box.width / 2,
    0,
  );

  // The zoom stops at 3000% and at 10%.
  const centre: [number, number] = [
    box.x + box.width / 2,
    box.y + box.height / 2,
  ];
  for (let i = 0; i < 40; i += 1)
    await wheel(page, centre, -100, { ctrlKey: true });
  await expect.poll(() => zoomPercent(page)).toBe(3000);
  for (let i = 0; i < 80; i += 1)
    await wheel(page, centre, 100, { ctrlKey: true });
  await expect.poll(() => zoomPercent(page)).toBe(10);
});

test("handles, hit testing, the label editor and cursors line up at every zoom on a 2x screen", async ({
  browser,
  api,
}) => {
  const board = await createBoard(api, [marker(0, 0)]);
  const contextFor = (role: "owner" | "admin") =>
    browser.newContext({
      baseURL: E2E_WEB_URL,
      locale: "en-US",
      storageState: authFile(role),
      deviceScaleFactor: 2,
    });
  const ownerContext = await contextFor("owner");
  const peerContext = await contextFor("admin");
  try {
    const page = await ownerContext.newPage();
    const peer = await peerContext.newPage();
    const problems = watchConsole(page);
    const { canvas } = await openBoard(page, board.id);
    await openBoard(peer, board.id);

    // The backing store holds every device pixel: crisp, not stretched.
    const first = await colourBox(page, MARKER_RGB);
    expect(first?.backing[0]).toBe(Math.round((first?.backing[2] ?? 0) * 2));
    expect(first?.backing[1]).toBe(Math.round((first?.backing[3] ?? 0) * 2));

    for (const percent of [10, 50, 200, 800]) {
      await canvas.focus();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Shift+1");
      for (let i = 0; i < 30 && (await zoomPercent(page)) !== percent; i += 1) {
        const now = await zoomPercent(page);
        await page
          .getByRole("button", {
            name: now < percent ? "Zoom in" : "Zoom out",
            exact: true,
          })
          .click();
      }
      expect(await zoomPercent(page)).toBe(percent);
      const view =
        percent === 800
          ? null
          : await viewOf(page, { x: 0, y: 0 }, percent / 100);
      if (percent === 800) {
        // The square covers the middle of the screen: a click there hits it.
        await page.mouse.click(
          ...(await canvas
            .boundingBox()
            .then(
              (b) =>
                [
                  (b?.x ?? 0) + (b?.width ?? 0) / 2 + 100,
                  (b?.y ?? 0) + (b?.height ?? 0) / 2,
                ] as [number, number],
            )),
        );
        await expect(page.getByRole("region", { name: "Style" })).toContainText(
          "Corners",
        );
        continue;
      }
      if (!view) throw new Error(`no marker at ${percent}%`);
      expect(view.zoom).toBeCloseTo(percent / 100, 1);

      // A click just inside the square's edge selects it, and its corner
      // handle resizes it by the pointer distance in board units.
      await page.mouse.click(...view.toPage(2, 50));
      const handle = view.toPage(100, 100);
      await drag(
        page,
        [handle[0] + 4, handle[1] + 4],
        [handle[0] + 24, handle[1] + 4],
        { steps: 4 },
      );
      await expect
        .poll(async () => byId(await elementsOf(api, board.id), "marker").width)
        .toBeCloseTo(100 + 20 / (percent / 100), 1);
      await page.keyboard.press("ControlOrMeta+z");
      await expect
        .poll(async () => byId(await elementsOf(api, board.id), "marker").width)
        .toBe(100);

      if (percent >= 50) {
        // The label editor sits on the shape.
        await page.mouse.dblclick(...view.toPage(50, 50));
        const editor = page.getByRole("textbox", { name: "Text", exact: true });
        await expect(editor).toBeVisible();
        // The label editor lies on the square, wherever the view is.
        const editorBox = await editor.boundingBox();
        if (!editorBox) throw new Error("the label editor has no box");
        const [left, top] = view.toPage(0, 0);
        const [right, bottom] = view.toPage(100, 100);
        expect(editorBox.x).toBeGreaterThanOrEqual(left - 2);
        expect(editorBox.y).toBeGreaterThanOrEqual(top - 2);
        expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(right + 2);
        expect(editorBox.y + editorBox.height).toBeLessThanOrEqual(bottom + 2);
        await page.keyboard.press("Escape");
        await expect(editor).toBeHidden();
      }

      // The peer points at the square's corner: the cursor tip lands there.
      await page.keyboard.press("Escape");
      const peerView = await viewOf(peer, { x: 0, y: 0 }, 1);
      await peer.mouse.move(...peerView.toPage(0, 0));
      const corner = view.toPage(0, 0);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const overlay = document.querySelectorAll<HTMLCanvasElement>(
              "[role='application'] canvas",
            )[1];
            const ctx = overlay?.getContext("2d");
            if (!overlay || !ctx) return null;
            const data = ctx.getImageData(
              0,
              0,
              overlay.width,
              overlay.height,
            ).data;
            let minX = Number.POSITIVE_INFINITY;
            let minY = Number.POSITIVE_INFINITY;
            for (let y = 0; y < overlay.height; y += 1) {
              for (let x = 0; x < overlay.width; x += 1) {
                if ((data[(y * overlay.width + x) * 4 + 3] ?? 0) > 200) {
                  minX = Math.min(minX, x);
                  minY = Math.min(minY, y);
                }
              }
            }
            const rect = overlay.getBoundingClientRect();
            const ratio = overlay.width / rect.width;
            return minX === Number.POSITIVE_INFINITY
              ? null
              : [rect.left + minX / ratio, rect.top + minY / ratio];
          }),
        )
        .toEqual([
          expect.closeTo(corner[0] - 1, -0.5),
          expect.closeTo(corner[1] - 1, -0.5),
        ]);
    }
    expect(problems).toEqual([]);
  } finally {
    await ownerContext.close();
    await peerContext.close();
  }
});

test("two fingers pinch-zoom around their midpoint and pan", async ({
  browser,
  api,
}) => {
  const board = await createBoard(api, [
    marker(0, 0),
    { id: "other", type: "rectangle", x: 300, y: 200, width: 100, height: 100 },
  ]);
  const context = await browser.newContext({
    baseURL: E2E_WEB_URL,
    locale: "en-US",
    storageState: authFile("owner"),
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await openBoard(page, board.id);
    const cdp = await context.newCDPSession(page);
    const touch = (type: string, points: [number, number][]) =>
      cdp.send("Input.dispatchTouchEvent", {
        type: type as "touchStart",
        touchPoints: points.map(([x, y], id) => ({ x, y, id })),
      });
    await nextFrame(page);
    const start = await colourBox(page, MARKER_RGB);
    if (!start) throw new Error("no marker");
    const mid: [number, number] = [start.x + 60, start.y + 55];
    await touch("touchStart", [
      [mid[0] - 50, mid[1]],
      [mid[0] + 50, mid[1]],
    ]);
    let last = start.width;
    for (let i = 1; i <= 10; i += 1) {
      await touch("touchMove", [
        [mid[0] - 50 - i * 5, mid[1]],
        [mid[0] + 50 + i * 5, mid[1]],
      ]);
      await nextFrame(page);
      const now = (await colourBox(page, MARKER_RGB))?.width ?? 0;
      // Smooth: each move grows the view a little, never in a jump.
      expect(now / last).toBeLessThan(1.15);
      last = now;
    }
    await touch("touchEnd", []);
    await expect.poll(() => zoomPercent(page)).toBe(200);
    await nextFrame(page);
    const end = await colourBox(page, MARKER_RGB);
    if (!end) throw new Error("no marker");
    const fx = (mid[0] - start.x) / start.width;
    expect(end.x + fx * end.width).toBeCloseTo(mid[0], 0);

    await touch("touchStart", [
      [mid[0] - 50, mid[1]],
      [mid[0] + 50, mid[1]],
    ]);
    for (let i = 1; i <= 5; i += 1) {
      await touch("touchMove", [
        [mid[0] - 50 + i * 10, mid[1] + i * 6],
        [mid[0] + 50 + i * 10, mid[1] + i * 6],
      ]);
    }
    await touch("touchEnd", []);
    await nextFrame(page);
    const panned = await colourBox(page, MARKER_RGB);
    expect((panned?.x ?? 0) - end.x).toBeCloseTo(50, 0);
    expect((panned?.y ?? 0) - end.y).toBeCloseTo(30, 0);
    // Nothing on the board moved.
    const list = await elementsOf(api, board.id);
    expect(byId(list, "marker")).toMatchObject({ x: 0, y: 0, width: 100 });
  } finally {
    await context.close();
  }
});
