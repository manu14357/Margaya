import { readFileSync } from "node:fs";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { asAnonymous, test } from "../../../fixtures";
import { createWorld, eventually, type World } from "../../../helpers/api-kit";
import { authFile } from "../../../helpers/auth";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { createApiContext, readJson } from "../../../helpers/http";
import {
  createProject,
  deleteProject,
  type TestProject,
} from "../../../helpers/task-data";
import { signInViaUI, uniqueName } from "../../../helpers/ui";
import { expect, projectPath } from "./_support";

// The shape library, pen styles and board backgrounds in the browser, driven
// with the mouse and keyboard on the canvas: drawing library shapes, labels and
// bound arrows, changing and adding shapes, marker and highlighter strokes,
// background patterns seen by everyone (and the public link), snap-to-grid
// showing its grid, PNG export, and the phone layout of the new controls.
// Every test works in a project this file creates.

type Element = Record<string, unknown> & {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
type Settings = {
  background: string;
  gridSize: number;
  pattern: string;
  patternSize: number;
};
type Content = { elements: Element[]; settings: Settings };
type Board = { id: string; title: string };

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
  project = await createProject(api, { name: uniqueName("Board shapes") });
  await api.dispose();
});

test.afterAll(async () => {
  const api = await ownerApi();
  if (project) await deleteProject(api, project.id);
  await api.dispose();
});

function boardPath(boardId: string, projectId = project.id): string {
  return `${projectPath(projectId, "whiteboards")}/${boardId}`;
}

async function createBoard(
  api: APIRequestContext,
  projectId = project.id,
): Promise<Board> {
  return readJson<Board>(
    await api.post("/api/whiteboard", {
      data: { projectId, title: uniqueName("Board") },
    }),
    "create whiteboard",
  );
}

async function boardContent(
  api: APIRequestContext,
  boardId: string,
): Promise<Content> {
  return readJson<Content>(
    await api.get(`/api/whiteboard/${boardId}/content`),
    "whiteboard content",
  );
}

async function elementsOf(
  api: APIRequestContext,
  boardId: string,
): Promise<Element[]> {
  return (await boardContent(api, boardId)).elements;
}

function canvasLocator(page: Page): Locator {
  return page.getByRole("application", { name: "Whiteboard canvas" });
}

/** Opens a board; `at` turns canvas offsets into page points. */
async function openBoard(page: Page, path: string) {
  await page.goto(path);
  const canvas = canvasLocator(page);
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the whiteboard canvas has no box");
  const at = (dx: number, dy: number): [number, number] => [
    box.x + dx,
    box.y + dy,
  ];
  return { canvas, box, at };
}

function tool(page: Page, name: string): Locator {
  return page
    .getByRole("toolbar", { name: "Tools" })
    .getByRole("button", { name, exact: true });
}

function stylePanel(page: Page): Locator {
  return page.getByRole("region", { name: "Style" });
}

async function drag(
  page: Page,
  from: [number, number],
  to: [number, number],
  steps = 12,
) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps });
  await page.mouse.up();
}

/** A wavy freehand stroke from `start`, `length` canvas pixels long. */
async function stroke(
  page: Page,
  at: (dx: number, dy: number) => [number, number],
  start: [number, number],
  length = 200,
) {
  await page.mouse.move(...at(...start));
  await page.mouse.down();
  for (let i = 1; i <= 20; i += 1) {
    await page.mouse.move(
      ...at(start[0] + (i * length) / 20, start[1] + Math.sin(i / 2) * 12),
    );
  }
  await page.mouse.up();
}

/** Types into the text editor the board opens for a new or edited label. */
async function typeText(page: Page, text: string) {
  const editor = page.getByRole("textbox", { name: "Text", exact: true });
  await expect(editor).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
}

function centreOf(element: Element): [number, number] {
  return [element.x + element.width / 2, element.y + element.height / 2];
}

/**
 * Reads the background layer in an empty area of the canvas: how many pixels
 * differ from the paper, and the spacing between the columns that carry the
 * pattern's marks. A regular pattern gives evenly spaced columns.
 */
async function backgroundMarks(
  page: Page,
): Promise<{ ink: number; gaps: number[] }> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "[role='application'] canvas",
    );
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return { ink: 0, gaps: [] };
    const width = Math.min(320, Math.floor(canvas.width / 2) - 8);
    const height = Math.min(200, Math.floor(canvas.height / 2) - 8);
    const left = Math.floor(canvas.width / 2);
    const top = Math.floor(canvas.height / 2);
    const data = ctx.getImageData(left, top, width, height).data;
    const tally = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      const key =
        ((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0);
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    let paper = 0;
    let most = -1;
    for (const [key, count] of tally) {
      if (count > most) {
        most = count;
        paper = key;
      }
    }
    const pr = (paper >> 16) & 255;
    const pg = (paper >> 8) & 255;
    const pb = paper & 255;
    const columns = new Array<number>(width).fill(0);
    let ink = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const diff = Math.max(
          Math.abs((data[i] ?? 0) - pr),
          Math.abs((data[i + 1] ?? 0) - pg),
          Math.abs((data[i + 2] ?? 0) - pb),
        );
        if (diff > 3) {
          ink += 1;
          columns[x] = (columns[x] ?? 0) + 1;
        }
      }
    }
    const sorted = [...columns].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const threshold = (max + median) / 2;
    const peaks: number[] = [];
    columns.forEach((count, x) => {
      if (max === median || count <= threshold) return;
      // Antialiased marks spread over neighbouring columns: one run, one peak.
      const last = peaks[peaks.length - 1];
      if (last !== undefined && x - last <= 3) return;
      peaks.push(x);
    });
    return {
      ink,
      gaps: peaks.slice(1).map((x, index) => x - (peaks[index] ?? 0)),
    };
  });
}

/** Waits until an element is drawn at its laid-out size (no scale-in left). */
async function waitUntilSettled(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        // The computed width ignores transforms; the drawn box does not.
        const laidOut = Number.parseFloat(getComputedStyle(element).width);
        return Math.abs(element.getBoundingClientRect().width - laidOut) < 0.01;
      }),
    )
    .toBe(true);
}

/** Evenly spaced marks, about `spacing` pixels apart. */
function expectRegular(gaps: number[], spacing: number) {
  expect(gaps.length).toBeGreaterThanOrEqual(3);
  for (const gap of gaps) {
    expect(Math.abs(gap - spacing)).toBeLessThanOrEqual(2);
  }
}

/** Records console errors (and app warnings) a test can assert on. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    // The dev server's sockets close on the strict-mode remount.
    if (/WebSocket is closed before the connection/.test(text)) return;
    // Reading the canvas back in this spec.
    if (/willReadFrequently/.test(text)) return;
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`[${message.type()}] ${text}`);
    }
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

test("the shape library: search, draw, Shift for even sides, a label, a bound arrow, Change shape and Add shape", async ({
  page,
  api,
}) => {
  const board = await createBoard(api);
  const { at, canvas } = await openBoard(page, boardPath(board.id));
  const search = page.getByRole("searchbox", { name: "Search shapes" });

  // Open the library from the chevron, find the hexagon and draw it.
  await page.getByRole("button", { name: "Shape library" }).click();
  await expect(search).toBeFocused();
  await search.fill("hex");
  await expect(
    page.getByRole("region", { name: "Basic" }).getByRole("button"),
  ).toHaveCount(0);
  await page
    .getByRole("region", { name: "Polygons" })
    .getByRole("button", { name: "Hexagon", exact: true })
    .click();
  await expect(search).toBeHidden();
  // The shape button now draws the hexagon.
  await expect(tool(page, "Hexagon")).toHaveAttribute("aria-pressed", "true");
  await drag(page, at(320, 150), at(480, 270));
  const hexagon = await eventually(
    async () =>
      (await elementsOf(api, board.id)).find(
        (el) => el.type === "shape" && el.shape === "hexagon",
      ),
    { what: "the hexagon" },
  );
  expect(Math.abs(hexagon.width - 160)).toBeLessThanOrEqual(4);
  expect(Math.abs(hexagon.height - 120)).toBeLessThanOrEqual(4);

  // Shift+S opens the library too; Enter picks the first match. Holding Shift
  // while dragging keeps the sides even.
  await canvas.focus();
  await page.keyboard.press("Shift+S");
  await expect(search).toBeFocused();
  await search.fill("star");
  await search.press("Enter");
  await expect(search).toBeHidden();
  await page.keyboard.down("Shift");
  await drag(page, at(660, 150), at(800, 240));
  await page.keyboard.up("Shift");
  const star = await eventually(
    async () =>
      (await elementsOf(api, board.id)).find((el) => el.shape === "star"),
    { what: "the star" },
  );
  expect(star.type).toBe("shape");
  expect(star.width).toBeGreaterThan(50);
  expect(star.width).toBe(star.height);

  // Double-click the hexagon to give it a label.
  await page.keyboard.press("Escape");
  await page.mouse.dblclick(...at(...centreOf(hexagon)));
  await typeText(page, "Hex label");
  await expect
    .poll(
      async () =>
        (await elementsOf(api, board.id)).find((el) => el.id === hexagon.id)
          ?.text,
    )
    .toBe("Hex label");

  // An arrow from the hexagon to the star binds both ends.
  await tool(page, "Arrow").click();
  await drag(page, at(...centreOf(hexagon)), at(...centreOf(star)), 15);
  await expect
    .poll(async () => {
      const arrow = (await elementsOf(api, board.id)).find(
        (el) => el.type === "arrow",
      );
      return {
        start: (arrow?.startBinding as { elementId?: string } | null)
          ?.elementId,
        end: (arrow?.endBinding as { elementId?: string } | null)?.elementId,
      };
    })
    .toEqual({ start: hexagon.id, end: star.id });

  // Box-select just the hexagon and make it a cloud from the Style panel.
  await page.keyboard.press("Escape");
  await tool(page, "Select").click();
  await drag(
    page,
    at(hexagon.x - 20, hexagon.y - 20),
    at(hexagon.x + hexagon.width + 20, hexagon.y + hexagon.height + 20),
  );
  await stylePanel(page).getByRole("button", { name: "Change shape" }).click();
  await expect(search).toBeFocused();
  await page
    .getByRole("region", { name: "Symbols" })
    .getByRole("button", { name: "Cloud", exact: true })
    .click();
  await expect
    .poll(async () => {
      const elements = await elementsOf(api, board.id);
      const changed = elements.find((el) => el.id === hexagon.id);
      const arrow = elements.find((el) => el.type === "arrow");
      return {
        type: changed?.type,
        shape: changed?.shape,
        text: changed?.text,
        start: (arrow?.startBinding as { elementId?: string } | null)
          ?.elementId,
        end: (arrow?.endBinding as { elementId?: string } | null)?.elementId,
      };
    })
    .toEqual({
      type: "shape",
      shape: "cloud",
      text: "Hex label",
      start: hexagon.id,
      end: star.id,
    });

  // Right-click empty canvas: Add shape places one centred on the click.
  await page.keyboard.press("Escape");
  const spot: [number, number] = [420, 430];
  await page.mouse.click(...at(...spot), { button: "right" });
  const menu = page.getByRole("menu", { name: "Canvas actions" });
  await menu.getByRole("menuitem", { name: "Add shape" }).click();
  await page.getByRole("menuitem", { name: "Triangle", exact: true }).click();
  await expect(menu).toBeHidden();
  const triangle = await eventually(
    async () =>
      (await elementsOf(api, board.id)).find((el) => el.shape === "triangle"),
    { what: "the added triangle" },
  );
  const [tx, ty] = centreOf(triangle);
  expect(Math.abs(tx - spot[0])).toBeLessThanOrEqual(2);
  expect(Math.abs(ty - spot[1])).toBeLessThanOrEqual(2);
});

test("pens: marker and highlighter strokes, and restyling a drawing", async ({
  page,
  api,
}) => {
  const board = await createBoard(api);
  const { at } = await openBoard(page, boardPath(board.id));
  const panel = stylePanel(page);

  await tool(page, "Pen").click();
  await panel.getByRole("button", { name: "Marker", exact: true }).click();
  await stroke(page, at, [340, 160]);
  await panel.getByRole("button", { name: "Highlighter", exact: true }).click();
  await stroke(page, at, [340, 320]);

  await expect
    .poll(async () =>
      (await elementsOf(api, board.id))
        .filter((el) => el.type === "draw")
        .map((el) => el.penStyle)
        .sort(),
    )
    .toEqual(["highlighter", "marker"]);
  const drawings = (await elementsOf(api, board.id)).filter(
    (el) => el.type === "draw",
  );
  const marker = drawings.find((el) => el.penStyle === "marker") as Element;
  const highlighter = drawings.find(
    (el) => el.penStyle === "highlighter",
  ) as Element;
  // The highlighter starts in its own yellow, not the pen's ink.
  expect(highlighter.strokeColor).toBe("#facc15");
  expect(marker.strokeColor).not.toBe("#facc15");

  // Select the marker stroke and turn it into a plain pen stroke.
  await page.keyboard.press("Escape");
  await tool(page, "Select").click();
  await drag(
    page,
    at(marker.x - 20, marker.y - 20),
    at(marker.x + marker.width + 20, marker.y + marker.height + 20),
  );
  await expect(
    panel.getByRole("button", { name: "Marker", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "Pen", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await elementsOf(api, board.id)).find((el) => el.id === marker.id)
          ?.penStyle,
    )
    .toBe("pen");
  expect(
    (await elementsOf(api, board.id)).find((el) => el.id === highlighter.id)
      ?.penStyle,
  ).toBe("highlighter");
});

test("the background: pattern, spacing and paper, seen by a second person and a viewer, then exported", async ({
  page,
  api,
  pageAs,
}) => {
  const board = await createBoard(api);
  await openBoard(page, boardPath(board.id));
  // An empty board draws no pattern.
  expect((await backgroundMarks(page)).ink).toBe(0);

  await page.getByRole("button", { name: "Background", exact: true }).click();
  const popover = page.getByRole("dialog").filter({
    has: page.getByRole("group", { name: "Pattern" }),
  });
  await popover.getByRole("button", { name: "Dots", exact: true }).click();
  await expect
    .poll(async () => (await boardContent(api, board.id)).settings.pattern)
    .toBe("dots");
  await expect
    .poll(async () => (await backgroundMarks(page)).gaps.length)
    .toBeGreaterThanOrEqual(3);
  expectRegular((await backgroundMarks(page)).gaps, 24);

  await popover.getByRole("button", { name: "Grid", exact: true }).click();
  const spacing = popover.getByRole("slider", { name: "Spacing" });
  await spacing.focus();
  await page.keyboard.press("End");
  await expect(popover.getByText("Large", { exact: true })).toBeVisible();
  await popover.getByRole("button", { name: "Cream", exact: true }).click();
  await expect
    .poll(async () => (await boardContent(api, board.id)).settings)
    .toMatchObject({
      pattern: "grid",
      patternSize: 40,
      background: "#fbf8f1",
    });
  await expect.poll(async () => (await backgroundMarks(page)).gaps[0]).toBe(40);
  expectRegular((await backgroundMarks(page)).gaps, 40);
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();

  // A second person sees the same background, drawn and in the control.
  const member = await pageAs("member");
  const memberProblems = watchConsole(member);
  await openBoard(member, boardPath(board.id));
  await expect
    .poll(async () => (await backgroundMarks(member)).gaps.length)
    .toBeGreaterThanOrEqual(3);
  expectRegular((await backgroundMarks(member)).gaps, 40);
  await member.getByRole("button", { name: "Background", exact: true }).click();
  await expect(
    member.getByRole("button", { name: "Grid", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    member.getByRole("button", { name: "Cream", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await member.keyboard.press("Escape");
  expect(memberProblems).toEqual([]);

  // A viewer sees it too, but has no control to change it.
  const viewer = await pageAs("viewer");
  const viewerProblems = watchConsole(viewer);
  await openBoard(viewer, boardPath(board.id));
  await expect(
    viewer.getByText("You can view this board but not edit it."),
  ).toBeVisible();
  await expect
    .poll(async () => (await backgroundMarks(viewer)).gaps.length)
    .toBeGreaterThanOrEqual(3);
  await expect(
    viewer.getByRole("button", { name: "Background", exact: true }),
  ).toHaveCount(0);
  expect(viewerProblems).toEqual([]);

  // Export as PNG: a real PNG with the board embedded.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const [png] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Export as PNG" }).click(),
  ]);
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  const bytes = readFileSync(await png.path());
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.length).toBeGreaterThan(1_000);
});

test("Snap to grid on a plain board shows its grid", async ({ page, api }) => {
  const board = await createBoard(api);
  const { at } = await openBoard(page, boardPath(board.id));
  expect((await backgroundMarks(page)).ink).toBe(0);

  await page.mouse.click(...at(500, 300), { button: "right" });
  const menu = page.getByRole("menu", { name: "Canvas actions" });
  const snap = menu.getByRole("menuitemcheckbox", { name: "Snap to grid" });
  await expect(snap).not.toBeChecked();
  await snap.click();
  await expect
    .poll(async () => (await boardContent(api, board.id)).settings)
    .toMatchObject({ pattern: "plain", gridSize: 20 });
  await expect
    .poll(async () => (await backgroundMarks(page)).gaps.length)
    .toBeGreaterThanOrEqual(3);
  expectRegular((await backgroundMarks(page)).gaps, 20);

  // Off again: the grid goes with it.
  await page.mouse.click(...at(500, 300), { button: "right" });
  await expect(snap).toBeChecked();
  await snap.click();
  await expect
    .poll(async () => (await boardContent(api, board.id)).settings.gridSize)
    .toBe(0);
  await expect.poll(async () => (await backgroundMarks(page)).ink).toBe(0);
});

test.describe("the public link", () => {
  let world: World;

  test.beforeAll(async () => {
    world = await createWorld("Whiteboard background");
  });
  test.afterAll(async () => {
    await world?.dispose();
  });

  test.use(asAnonymous);

  test("shows the board's background pattern signed out", async ({
    page,
    browser,
  }) => {
    const owner = world.users.owner;
    await readJson(
      await owner.ctx.patch(`/api/workspace/${world.workspace.id}/settings`, {
        data: { allowPublicPages: true },
      }),
      "allow public pages",
    );
    const own = await readJson<{ id: string }>(
      await owner.ctx.post("/api/project", {
        data: {
          name: uniqueName("Patterned"),
          slug: `B${Math.random().toString(36).slice(2, 7)}`.toUpperCase(),
          icon: "Layout",
          workspaceId: world.workspace.id,
        },
      }),
      "create project",
    );
    const board = await createBoard(owner.ctx, own.id);

    await signInViaUI(page, owner);
    await openBoard(
      page,
      `/dashboard/workspace/${world.workspace.id}/project/${own.id}/whiteboards/${board.id}`,
    );
    await page.getByRole("button", { name: "Background", exact: true }).click();
    await page.getByRole("button", { name: "Lines", exact: true }).click();
    await page.getByRole("button", { name: "Mint", exact: true }).click();
    await expect
      .poll(async () => (await boardContent(owner.ctx, board.id)).settings)
      .toMatchObject({ pattern: "lines", background: "#f0f7f2" });
    await page.keyboard.press("Escape");

    const published = await readJson<{ publicToken: string }>(
      await owner.ctx.post(`/api/whiteboard/${board.id}/publication`),
      "publish whiteboard",
    );

    // The public read serves the stored board, saved shortly after edits.
    await expect
      .poll(
        async () =>
          (
            await readJson<{ settings: Settings }>(
              await world
                .as("anonymous")
                .get(`/api/public-whiteboard/${published.publicToken}`),
              "public whiteboard",
            )
          ).settings.pattern,
        { timeout: 30_000 },
      )
      .toBe("lines");

    const anonymous = await browser.newContext({ baseURL: E2E_WEB_URL });
    try {
      const reader = await anonymous.newPage();
      const problems = watchConsole(reader);
      const response = reader.waitForResponse((res) =>
        res.url().includes(`/api/public-whiteboard/${published.publicToken}`),
      );
      await reader.goto(`/public-whiteboard/${published.publicToken}`);
      const body = (await (await response).json()) as { settings: Settings };
      expect(body.settings).toMatchObject({
        pattern: "lines",
        patternSize: 24,
        background: "#f0f7f2",
      });
      await expect(canvasLocator(reader)).toBeVisible();
      // Ruled lines are horizontal: no column stands out, but ink is there.
      await expect
        .poll(async () => (await backgroundMarks(reader)).ink)
        .toBeGreaterThan(1_000);
      await expect(
        reader.getByRole("button", { name: "Background", exact: true }),
      ).toHaveCount(0);
      expect(problems).toEqual([]);
    } finally {
      await anonymous.close();
    }
  });
});

test("on a 390px phone the shape library and the background are within reach", async ({
  browser,
  api,
}) => {
  const board = await createBoard(api);
  const context = await browser.newContext({
    baseURL: E2E_WEB_URL,
    storageState: authFile("member"),
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const phone = await context.newPage();
    const problems = watchConsole(phone);
    await openBoard(phone, boardPath(board.id));

    // The toolbar's shape button opens the library directly.
    await tool(phone, "Shape library").tap();
    const search = phone.getByRole("searchbox", { name: "Search shapes" });
    await expect(search).toBeVisible();
    // Measure once the popover has finished scaling in.
    await waitUntilSettled(search);
    for (const group of ["Basic", "Polygons"]) {
      const buttons = phone
        .getByRole("region", { name: group })
        .getByRole("button");
      expect(await buttons.count()).toBeGreaterThan(3);
      for (const button of await buttons.all()) {
        const size = await button.boundingBox();
        // 44px touch targets, give or take sub-pixel layout.
        expect(size?.width ?? 0).toBeGreaterThanOrEqual(43.9);
        expect(size?.height ?? 0).toBeGreaterThanOrEqual(43.9);
      }
    }
    await phone
      .getByRole("region", { name: "Polygons" })
      .getByRole("button", { name: "Octagon", exact: true })
      .tap();
    await expect(search).toBeHidden();
    await expect(tool(phone, "Shape library")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // With nothing selected, the Style popover holds the background.
    await tool(phone, "Select").tap();
    await phone.getByRole("button", { name: "Style", exact: true }).tap();
    const background = phone.getByRole("region", { name: "Background" });
    await expect(background).toBeVisible();
    const dots = background.getByRole("button", { name: "Dots", exact: true });
    await waitUntilSettled(dots);
    const dotsBox = await dots.boundingBox();
    expect(dotsBox?.height ?? 0).toBeGreaterThanOrEqual(43.9);
    await dots.tap();
    await expect
      .poll(async () => (await boardContent(api, board.id)).settings.pattern)
      .toBe("dots");
    expect(problems).toEqual([]);
  } finally {
    await context.close();
  }
});
