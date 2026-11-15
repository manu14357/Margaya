import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { asAnonymous, test } from "../../../fixtures";
import { createWorld, eventually, type World } from "../../../helpers/api-kit";
import { authFile } from "../../../helpers/auth";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { createApiContext, readJson } from "../../../helpers/http";
import {
  createProject,
  createTask,
  deleteProject,
  listBoard,
  type TestProject,
  taskPagePath,
} from "../../../helpers/task-data";
import { signInViaUI, uniqueName } from "../../../helpers/ui";
import { SEED_USERS } from "../../../seed/data";
import { expect, projectPath } from "./_support";

// Whiteboards in the browser: the project section, creating boards, drawing
// every kind of element with the mouse, selection and transforms, undo, text
// and colour edits, persistence, live collaboration between two people,
// read-only and locked boards, task cards and stickies turned into tasks,
// export, the public link, archive and trash, the theme and a phone layout.
// Every test works in a project this file creates.

type Element = Record<string, unknown> & {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
type Board = {
  id: string;
  title: string;
  elementCount: number;
  archivedAt: string | null;
};

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
  project = await createProject(api, { name: uniqueName("Whiteboards") });
  await api.dispose();
});

test.afterAll(async () => {
  const api = await ownerApi();
  if (project) await deleteProject(api, project.id);
  await api.dispose();
});

function boardsPath(projectId = project.id): string {
  return projectPath(projectId, "whiteboards");
}

function boardPath(boardId: string, projectId = project.id): string {
  return `${boardsPath(projectId)}/${boardId}`;
}

async function createBoard(
  api: APIRequestContext,
  data: Record<string, unknown> = {},
  projectId = project.id,
): Promise<Board> {
  return readJson<Board>(
    await api.post("/api/whiteboard", {
      data: { projectId, title: uniqueName("Board"), ...data },
    }),
    "create whiteboard",
  );
}

async function boardContent(
  api: APIRequestContext,
  boardId: string,
): Promise<Element[]> {
  const body = await readJson<{ elements: Element[] }>(
    await api.get(`/api/whiteboard/${boardId}/content`),
    "whiteboard content",
  );
  return body.elements;
}

function byType(elements: Element[], type: string): Element[] {
  return elements.filter((element) => element.type === type);
}

/** The editor's canvas, and a point on it relative to its top-left corner. */
async function openBoard(page: Page, boardId: string, projectId = project.id) {
  await page.goto(boardPath(boardId, projectId));
  const canvas = page.getByRole("application", { name: "Whiteboard canvas" });
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  return canvasOf(page);
}

async function canvasOf(page: Page) {
  const canvas = page.getByRole("application", { name: "Whiteboard canvas" });
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

/** Picks a shape for the Shapes button from the shape library. */
async function pickShape(page: Page, name: string) {
  await tool(page, "Shape library").click();
  await page
    .getByRole("region", { name: "Basic" })
    .getByRole("button", { name, exact: true })
    .click();
  await expect(
    page.getByRole("searchbox", { name: "Search shapes" }),
  ).toBeHidden();
}

async function drag(
  page: Page,
  from: [number, number],
  to: [number, number],
  steps = 10,
) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps });
  await page.mouse.up();
}

/** Types into the text editor the board opens for a new or edited element. */
async function typeText(page: Page, text: string, { replace = false } = {}) {
  const editor = page.getByRole("textbox", { name: "Text", exact: true });
  await expect(editor).toBeFocused();
  if (replace) await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
}

/** Opens Find on board and waits for a match. */
async function expectOnBoard(page: Page, text: string) {
  await page.getByRole("application", { name: "Whiteboard canvas" }).focus();
  await page.keyboard.press("ControlOrMeta+f");
  const dialog = page.getByRole("dialog", { name: "Find on board" });
  await dialog.getByPlaceholder("Search text on this board").fill(text);
  await expect(
    dialog.getByRole("list", { name: "Matches" }).getByText(text),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

/** Painted pixels on the interactive layer (selection, cursors, previews). */
async function overlayInk(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvases = document.querySelectorAll<HTMLCanvasElement>(
      "[role='application'] canvas",
    );
    const overlay = canvases[canvases.length - 1];
    const ctx = overlay?.getContext("2d");
    if (!overlay || !ctx) return 0;
    const data = ctx.getImageData(0, 0, overlay.width, overlay.height).data;
    let ink = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) ink += 1;
    return ink;
  });
}

/** Records console errors (and app warnings) a test can assert on. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    // The dev server's sockets close on the strict-mode remount.
    if (/WebSocket is closed before the connection/.test(text)) return;
    if (/willReadFrequently/.test(text)) return;
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`[${message.type()}] ${text}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`[pageerror] ${error}`));
  return problems;
}

// Console errors and warnings on the default page fail the test that caused
// them; pages opened with pageAs are watched by the tests themselves.
let consoleProblems: string[] = [];
test.beforeEach(({ page }) => {
  consoleProblems = watchConsole(page);
});
test.afterEach(() => {
  expect(consoleProblems).toEqual([]);
});

test("the Whiteboards section lists boards and creates them blank or from a template", async ({
  page,
  api,
}) => {
  await page.goto(projectPath(project.id, "board"));
  await page
    .getByRole("navigation", { name: "Project sections" })
    .getByRole("tab", { name: "Whiteboards" })
    .click();
  await expect(page).toHaveURL(/\/whiteboards$/);
  await expect(page.getByText("No whiteboards yet")).toBeVisible();

  // Blank board.
  await page.getByRole("button", { name: "New whiteboard" }).first().click();
  await expect(page).toHaveURL(/\/whiteboards\/[a-z0-9]+$/);
  await expect(
    page.getByRole("application", { name: "Whiteboard canvas" }),
  ).toBeVisible();
  const title = uniqueName("Planning");
  const name = page.getByRole("textbox", { name: "Whiteboard name" });
  await name.fill(title);
  await name.press("Enter");
  await page.getByRole("link", { name: "Back to whiteboards" }).click();
  await expect(page.getByText(title)).toBeVisible();

  // From a template.
  await page
    .getByRole("button", { name: "More ways to create a whiteboard" })
    .click();
  await page.getByRole("menuitem", { name: /Retrospective/ }).click();
  await expect(page).toHaveURL(/\/whiteboards\/[a-z0-9]+$/);
  const boardId = page.url().split("/").pop() as string;
  await expect
    .poll(async () =>
      (await boardContent(api, boardId))
        .map((element) => element.text ?? element.name ?? "")
        .join(" | "),
    )
    .toContain("Went well");
  await expectOnBoard(page, "To improve");

  // Both boards are listed, and search finds the board by its text.
  await page.getByRole("link", { name: "Back to whiteboards" }).click();
  await expect(page.getByText(title)).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search boards" })
    .fill("went well");
  await expect(page.getByText(title)).toBeHidden();
  await expect(page.getByText("Retrospective").first()).toBeVisible();
});

test("draw every kind of element, select, move, resize, undo, edit text and colour, then reload", async ({
  page,
  api,
}) => {
  const board = await createBoard(api);
  const { at } = await openBoard(page, board.id);

  await tool(page, "Rectangle").click();
  await drag(page, at(350, 120), at(500, 220));
  await pickShape(page, "Ellipse");
  await drag(page, at(650, 120), at(800, 220));
  // An arrow from inside the rectangle to inside the ellipse binds both ends.
  await tool(page, "Arrow").click();
  await drag(page, at(440, 170), at(720, 170));
  await tool(page, "Text").click();
  await page.mouse.click(...at(350, 300));
  await typeText(page, "Hello board");
  await tool(page, "Sticky note").click();
  await page.mouse.click(...at(700, 360));
  await typeText(page, "Sticky idea");
  await tool(page, "Pen").click();
  await page.mouse.move(...at(350, 450));
  await page.mouse.down();
  for (let i = 1; i <= 20; i += 1) {
    await page.mouse.move(...at(350 + i * 10, 450 + Math.sin(i / 2) * 20));
  }
  await page.mouse.up();

  await expect
    .poll(async () =>
      (await boardContent(api, board.id)).map((el) => el.type).sort(),
    )
    .toEqual(["arrow", "draw", "ellipse", "rectangle", "sticky", "text"]);
  let elements = await boardContent(api, board.id);
  const [rect] = byType(elements, "rectangle");
  const [ellipse] = byType(elements, "ellipse");
  const [arrow] = byType(elements, "arrow");
  expect(rect).toMatchObject({ width: 150, height: 100 });
  expect(arrow?.startBinding).toMatchObject({ elementId: rect?.id });
  expect(arrow?.endBinding).toMatchObject({ elementId: ellipse?.id });
  expect(byType(elements, "text")[0]?.text).toBe("Hello board");
  expect(byType(elements, "sticky")[0]?.text).toBe("Sticky idea");
  expect(
    ((byType(elements, "draw")[0]?.points ?? []) as unknown[]).length,
  ).toBeGreaterThan(5);

  // Select the rectangle by its outline and move it left.
  await page.keyboard.press("Escape");
  await tool(page, "Select").click();
  await drag(page, at(350, 200), at(320, 200));
  // Snapping to the other elements may round the move a little.
  await expect
    .poll(
      async () => byType(await boardContent(api, board.id), "rectangle")[0]?.x,
    )
    .toBeLessThan((rect?.x as number) - 20);
  elements = await boardContent(api, board.id);
  const moved = byType(elements, "rectangle")[0] as Element;
  // The bound arrow followed it.
  expect(byType(elements, "arrow")[0]?.x).not.toBe(arrow?.x);

  // Resize from the bottom-right handle, just outside the corner.
  await drag(
    page,
    at(moved.x + moved.width + 4, moved.y + moved.height + 4),
    at(moved.x + moved.width + 54, moved.y + moved.height + 54),
  );
  await expect
    .poll(
      async () =>
        byType(await boardContent(api, board.id), "rectangle")[0]?.width,
    )
    .toBeGreaterThan(180);

  // Undo the resize, then redo it, from the keyboard and the history buttons.
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(
      async () =>
        byType(await boardContent(api, board.id), "rectangle")[0]?.width,
    )
    .toBe(150);
  await page
    .getByRole("group", { name: "History" })
    .getByRole("button", { name: "Redo" })
    .click();
  await expect
    .poll(
      async () =>
        byType(await boardContent(api, board.id), "rectangle")[0]?.width,
    )
    .toBeGreaterThan(180);

  // Change the rectangle's stroke colour in the properties panel.
  const panel = page.getByRole("region", { name: "Style" });
  await panel
    .getByRole("group", { name: "Stroke" })
    .getByRole("button", { name: "Red" })
    .click();
  await expect
    .poll(
      async () =>
        byType(await boardContent(api, board.id), "rectangle")[0]?.strokeColor,
    )
    .toBe("#dc2626");

  // Edit the sticky's text with a double-click, then recolour it.
  await page.keyboard.press("Escape");
  await page.mouse.dblclick(...at(700, 360));
  await typeText(page, "Edited idea", { replace: true });
  await expect
    .poll(
      async () => byType(await boardContent(api, board.id), "sticky")[0]?.text,
    )
    .toBe("Edited idea");
  await panel
    .getByRole("group", { name: "Note color" })
    .getByRole("button", { name: "Blue" })
    .click();
  await expect
    .poll(
      async () =>
        byType(await boardContent(api, board.id), "sticky")[0]?.fillColor,
    )
    .toBe("#bae6fd");

  // Saved: the stored board counts every element, and a reload shows them.
  await expect
    .poll(
      async () =>
        (
          await readJson<Board>(
            await api.get(`/api/whiteboard/${board.id}`),
            "get whiteboard",
          )
        ).elementCount,
      { timeout: 20_000 },
    )
    .toBe(6);
  await page.reload();
  await expect(
    page.getByRole("application", { name: "Whiteboard canvas" }),
  ).toBeVisible();
  await expectOnBoard(page, "Edited idea");
  await expectOnBoard(page, "Hello board");
  expect(
    byType(await boardContent(api, board.id), "rectangle")[0]?.strokeColor,
  ).toBe("#dc2626");
});

test("two people see each other's cursor and edits live", async ({
  page,
  pageAs,
  api,
}) => {
  const board = await createBoard(api);
  const owner = await openBoard(page, board.id);
  const memberPage = await pageAs("member");
  const memberProblems = watchConsole(memberPage);
  const member = await openBoard(memberPage, board.id);

  // Each sees the other on the board.
  await expect(
    page.getByRole("button", { name: `Follow ${SEED_USERS.member.name}` }),
  ).toBeVisible();
  await expect(
    memberPage.getByRole("button", { name: `Follow ${SEED_USERS.owner.name}` }),
  ).toBeVisible();

  // The member's cursor is painted on the owner's board.
  await page.mouse.move(...owner.at(5, 5));
  const before = await overlayInk(page);
  await memberPage.mouse.move(...member.at(500, 300), { steps: 5 });
  await expect.poll(() => overlayInk(page)).toBeGreaterThan(before);

  // The member's sticky shows up on the owner's board.
  await tool(memberPage, "Sticky note").click();
  await memberPage.mouse.click(...member.at(600, 300));
  await typeText(memberPage, "Live from Mia");
  await expectOnBoard(page, "Live from Mia");

  // And the owner's edit reaches the member.
  await tool(page, "Text").click();
  await page.mouse.click(...owner.at(400, 450));
  await typeText(page, "Reply from Olivia");
  await expectOnBoard(memberPage, "Reply from Olivia");
  expect(memberProblems).toEqual([]);
});

test("a viewer sees the board read-only", async ({ api, pageAs }) => {
  const board = await createBoard(api, {
    elements: [
      {
        id: "v-1",
        type: "sticky",
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        text: "For viewers",
      },
    ],
  });
  const viewer = await pageAs("viewer");
  const viewerProblems = watchConsole(viewer);
  await openBoard(viewer, board.id);
  await expect(
    viewer.getByText("You can view this board but not edit it."),
  ).toBeVisible();
  await expect(tool(viewer, "Select")).toBeVisible();
  await expect(tool(viewer, "Rectangle")).toHaveCount(0);
  await expectOnBoard(viewer, "For viewers");
  // Keys that would draw or delete do nothing.
  await viewer.getByRole("application", { name: "Whiteboard canvas" }).focus();
  await viewer.keyboard.press("ControlOrMeta+a");
  await viewer.keyboard.press("Delete");
  expect(await boardContent(api, board.id)).toHaveLength(1);
  expect(viewerProblems).toEqual([]);
});

test("a locked board blocks edits until it is unlocked", async ({
  page,
  api,
}) => {
  const board = await createBoard(api);
  const { at } = await openBoard(page, board.id);
  await page.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(
    page.getByText(/locked this board|This board is locked/).first(),
  ).toBeVisible();
  await expect(tool(page, "Rectangle")).toHaveCount(0);
  // The server refuses writes too.
  const refused = await api.post(`/api/whiteboard/${board.id}/elements`, {
    data: {
      elements: [
        { id: "x", type: "sticky", x: 0, y: 0, width: 200, height: 200 },
      ],
    },
  });
  expect(refused.status()).toBe(409);

  await page.getByRole("button", { name: "Unlock" }).first().click();
  await expect(tool(page, "Rectangle")).toBeVisible();
  await tool(page, "Rectangle").click();
  await drag(page, at(400, 150), at(500, 250));
  await expect
    .poll(async () => (await boardContent(api, board.id)).length)
    .toBe(1);
});

test("insert a task card and turn stickies into tasks", async ({
  page,
  api,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Card task"),
  });
  const board = await createBoard(api);
  const { at } = await openBoard(page, board.id);

  await tool(page, "Task card").click();
  const picker = page.getByRole("dialog", { name: "Add task cards" });
  await picker
    .getByRole("textbox", { name: "Search tasks by title or key" })
    .fill(task.title);
  await picker.getByRole("button", { name: new RegExp(task.title) }).click();
  await picker.getByRole("button", { name: "Add 1 card" }).click();
  await expect(picker).toBeHidden();
  await expect
    .poll(
      async () => byType(await boardContent(api, board.id), "task")[0]?.taskId,
    )
    .toBe(task.id);

  const stickyTitle = uniqueName("From a note");
  await tool(page, "Sticky note").click();
  await page.mouse.click(...at(700, 400));
  await typeText(page, stickyTitle);
  await page
    .getByRole("region", { name: "Style" })
    .getByRole("button", { name: "Turn into a task" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Turn notes into tasks" });
  await expect(
    dialog.getByRole("textbox", { name: "Title of task 1" }),
  ).toHaveValue(stickyTitle);
  await dialog.getByRole("button", { name: "Create 1 task" }).click();
  await expect(page.getByText("Created 1 task")).toBeVisible();

  // The task exists in the project and its card replaced the sticky.
  const created = await eventually(
    async () =>
      (await listBoard(api, project.id)).columns
        .flatMap((column) => column.tasks)
        .find((entry) => entry.title === stickyTitle),
    { what: "the task made from the sticky" },
  );
  await expect
    .poll(async () => {
      const elements = await boardContent(api, board.id);
      return {
        stickies: byType(elements, "sticky").length,
        cards: byType(elements, "task")
          .map((el) => el.taskId)
          .sort(),
      };
    })
    .toEqual({ stickies: 0, cards: [task.id, created.id].sort() });

  // The task lists the board under "On whiteboards".
  await page.goto(taskPagePath(project.id, task.id));
  const section = page.getByText("On whiteboards");
  await expect(section).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: board.title })).toBeVisible();
});

/** A solid RGB PNG of the given size, built by hand (no image library). */
function solidPng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes)
      c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([4, 120, 87], 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("insert an image, crop it, and the crop survives a reload", async ({
  page,
  api,
}) => {
  const board = await createBoard(api);
  const { box } = await openBoard(page, board.id);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    tool(page, "Image").click(),
  ]);
  await chooser.setFiles({
    name: "green.png",
    mimeType: "image/png",
    buffer: solidPng(300, 200),
  });
  const image = await eventually(
    async () => {
      const found = byType(await boardContent(api, board.id), "image")[0];
      return found?.assetId ? found : undefined;
    },
    { what: "the uploaded image on the board" },
  );
  expect(image).toMatchObject({ width: 300, height: 200, crop: null });

  // The image sits at the centre of the view: select it, then crop.
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  const style = page.getByRole("region", { name: "Style" });
  await expect(async () => {
    await style.getByRole("button", { name: "Crop image" }).click();
    await expect(
      style.getByRole("button", { name: "Done cropping" }),
    ).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  // Pull the right edge in by a third, then finish with Enter.
  await drag(page, [cx + 150, cy], [cx + 50, cy]);
  await page.keyboard.press("Enter");
  await expect(style.getByRole("button", { name: "Crop image" })).toBeVisible();

  const cropped = await eventually(
    async () => {
      const found = byType(await boardContent(api, board.id), "image")[0];
      return found?.crop ? found : undefined;
    },
    { what: "the cropped image" },
  );
  const crop = cropped.crop as { x: number; width: number; height: number };
  expect(crop.x).toBeCloseTo(0, 0);
  expect(crop.width).toBeGreaterThan(180);
  expect(crop.width).toBeLessThan(220);
  expect(crop.height).toBeCloseTo(200, 0);
  expect(cropped.width).toBeLessThan(220);

  // After a reload the board still shows the crop, and it can be reset.
  await openBoard(page, board.id);
  expect(byType(await boardContent(api, board.id), "image")[0]?.crop).toEqual(
    cropped.crop,
  );
  await page.mouse.click(cx - 50, cy);
  await expect(
    page
      .getByRole("region", { name: "Style" })
      .getByRole("button", { name: "Reset crop" }),
  ).toBeEnabled();
});

test("an arrow between two task cards becomes a dependency, and deleting it can remove the dependency", async ({
  page,
  api,
}) => {
  const first = await createTask(api, project.id, {
    title: uniqueName("Blocker"),
  });
  const second = await createTask(api, project.id, {
    title: uniqueName("Blocked"),
  });
  const board = await createBoard(api);
  const { box } = await openBoard(page, board.id);

  await tool(page, "Task card").click();
  const picker = page.getByRole("dialog", { name: "Add task cards" });
  for (const task of [first, second]) {
    await picker
      .getByRole("textbox", { name: "Search tasks by title or key" })
      .fill(task.title);
    await picker.getByRole("button", { name: new RegExp(task.title) }).click();
  }
  await picker.getByRole("button", { name: "Add 2 cards" }).click();
  await expect(picker).toBeHidden();
  await eventually(
    async () =>
      byType(await boardContent(api, board.id), "task").length === 2 ||
      undefined,
    { what: "two task cards" },
  );

  // Two 260-wide cards, 24 apart, centred in the view, in pick order.
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await tool(page, "Arrow").click();
  await drag(page, [cx - 142, cy], [cx + 142, cy], 15);
  const arrow = await eventually(
    async () => {
      const found = byType(await boardContent(api, board.id), "arrow")[0];
      return found?.startBinding && found?.endBinding ? found : undefined;
    },
    { what: "an arrow bound to both cards" },
  );
  expect(arrow).toBeTruthy();

  const relations = async () =>
    readJson<
      {
        id: string;
        sourceTaskId: string;
        targetTaskId: string;
        relationType: string;
      }[]
    >(await api.get(`/api/task-relation/${first.id}`), "task relations");
  await page
    .getByRole("region", { name: "Style" })
    .getByRole("button", { name: "Make dependency" })
    .click();
  await expect(page.getByText("Dependency created")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await relations()).filter(
          (row) =>
            row.relationType === "blocks" &&
            row.sourceTaskId === first.id &&
            row.targetTaskId === second.id,
        ).length,
    )
    .toBe(1);

  // Deleting the arrow asks about the dependency; Remove deletes it too.
  await page.keyboard.press("Delete");
  const prompt = page.getByRole("region", { name: "Task dependency" });
  await expect(prompt).toContainText("Also remove the dependency between");
  await prompt.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Dependency removed")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await relations()).filter((row) => row.relationType === "blocks")
          .length,
    )
    .toBe(0);
  await expect
    .poll(async () => byType(await boardContent(api, board.id), "arrow").length)
    .toBe(0);
});

test("the History sheet lists what happened to the board", async ({
  page,
  api,
}) => {
  const board = await createBoard(api);
  const renamed = uniqueName("Renamed board");
  await readJson(
    await api.patch(`/api/whiteboard/${board.id}`, {
      data: { title: renamed },
    }),
    "rename whiteboard",
  );
  await openBoard(page, board.id);
  await page.getByRole("button", { name: "More board options" }).click();
  await page.getByRole("menuitem", { name: "History" }).click();
  const sheet = page.getByRole("dialog", { name: "Board history" });
  await expect(sheet).toBeVisible();
  const entries = sheet.getByRole("list", { name: "Board history" });
  await expect(
    entries.getByText(`Renamed the board to “${renamed}”`),
  ).toBeVisible();
  await expect(entries.getByText("Created the board")).toBeVisible();
  // Newest first, each with who did it.
  await expect(entries.getByRole("listitem").first()).toContainText("Renamed");
  await expect(entries.getByRole("listitem").first()).toContainText(
    SEED_USERS.owner.name,
  );

  // It updates while open: locking the board adds an entry.
  await readJson(
    await api.post(`/api/whiteboard/${board.id}/lock`),
    "lock whiteboard",
  );
  await expect(entries.getByText("Locked the board")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("export the board as PNG and SVG", async ({ page, api }) => {
  const board = await createBoard(api, {
    title: "Export board",
    elements: [
      {
        id: "e-1",
        type: "sticky",
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        text: "Exported",
      },
    ],
  });
  await openBoard(page, board.id);
  await expectOnBoard(page, "Exported");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const [png] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Export as PNG" }).click(),
  ]);
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  const pngBytes = readFileSync(await png.path());
  expect(pngBytes.subarray(1, 4).toString()).toBe("PNG");
  // The board is embedded so the image opens as a board again.
  expect(pngBytes.includes(Buffer.from("margaya-board"))).toBe(true);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const [svg] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Export as SVG" }).click(),
  ]);
  expect(svg.suggestedFilename()).toMatch(/\.svg$/);
  const svgText = readFileSync(await svg.path(), "utf8");
  expect(svgText).toContain("<svg");
  expect(svgText).toContain("Exported");
});

test.describe("publishing", () => {
  let world: World;

  test.beforeAll(async () => {
    world = await createWorld("Whiteboard publish");
  });
  test.afterAll(async () => {
    await world?.dispose();
  });

  test.use(asAnonymous);

  test("publish a board and open the public link signed out", async ({
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
          name: uniqueName("Published"),
          slug: `P${Math.random().toString(36).slice(2, 7)}`.toUpperCase(),
          icon: "Layout",
          workspaceId: world.workspace.id,
        },
      }),
      "create project",
    );
    const taskTitle = uniqueName("Public task");
    const task = await readJson<{ id: string }>(
      await owner.ctx.post(`/api/task/${own.id}`, {
        data: {
          title: taskTitle,
          description: "",
          status: "to-do",
          priority: "high",
        },
      }),
      "create task",
    );
    const board = await readJson<Board>(
      await owner.ctx.post("/api/whiteboard", {
        data: {
          projectId: own.id,
          title: "Public board",
          elements: [
            {
              id: "p-1",
              type: "sticky",
              x: 0,
              y: 0,
              width: 200,
              height: 200,
              text: "Hello public",
            },
            {
              id: "p-2",
              type: "task",
              x: 260,
              y: 0,
              width: 280,
              height: 120,
              taskId: task.id,
            },
          ],
        },
      }),
      "create board",
    );

    await signInViaUI(page, owner);
    await page.goto(
      `/dashboard/workspace/${world.workspace.id}/project/${own.id}/whiteboards/${board.id}`,
    );
    await page.getByRole("button", { name: "Share" }).click();
    const share = page.getByRole("dialog", { name: "Share whiteboard" });
    await share.getByRole("switch", { name: /Publish to the web/ }).click();
    const link = share.getByRole("textbox", { name: "Public link" });
    await expect(link).toHaveValue(/\/public-whiteboard\//);
    const url = await link.inputValue();
    await share.getByRole("button", { name: "Done" }).click();

    const anonymous = await browser.newContext({ baseURL: E2E_WEB_URL });
    try {
      const reader = await anonymous.newPage();
      const problems = watchConsole(reader);
      const publicResponse = reader.waitForResponse((response) =>
        response.url().includes("/api/public-whiteboard/"),
      );
      await reader.goto(url);
      const body = (await (await publicResponse).json()) as {
        tasks: Record<string, { title: string }>;
      };
      expect(body.tasks[task.id]?.title).toBe(taskTitle);
      await expect(reader.getByText("Public board").first()).toBeVisible();
      await expect(reader.getByText("Read-only").first()).toBeVisible();
      await expect(
        reader.getByRole("application", { name: "Whiteboard canvas" }),
      ).toBeVisible();
      await expect(tool(reader, "Rectangle")).toHaveCount(0);
      await expectOnBoard(reader, "Hello public");
      expect(problems).toEqual([]);
    } finally {
      await anonymous.close();
    }
  });
});

test("archive a board, move it to the trash and restore it from the project trash", async ({
  page,
  api,
}) => {
  const board = await createBoard(api, { title: uniqueName("Trash me") });
  await openBoard(page, board.id);
  await page.getByRole("button", { name: "More board options" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(
    page.getByText("This board is archived and read-only."),
  ).toBeVisible();

  await page.goto(boardsPath());
  await page.getByRole("tab", { name: "Archived" }).click();
  await page
    .getByRole("button", { name: `Actions for ${board.title}` })
    .click();
  await page.getByRole("menuitem", { name: "Move to trash" }).click();
  await page
    .getByRole("alertdialog")
    .or(page.getByRole("dialog"))
    .getByRole("button", { name: "Move to trash" })
    .click();
  await expect(page.getByText("Moved to Recently deleted")).toBeVisible();
  expect((await api.get(`/api/whiteboard/${board.id}`)).status()).toBe(404);

  await page.goto(`/dashboard/settings/projects/${project.id}/trash`);
  await page.getByRole("button", { name: `Restore ${board.title}` }).click();
  await expect
    .poll(async () => (await api.get(`/api/whiteboard/${board.id}`)).status())
    .toBe(200);
  // A restored board comes back archived.
  await page.goto(boardsPath());
  await page.getByRole("tab", { name: "Archived" }).click();
  await expect(page.getByText(board.title)).toBeVisible();
});

test("the editor follows the dark theme", async ({ pageAs, api }) => {
  const board = await createBoard(api, {
    elements: [
      {
        id: "d-1",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 200,
        height: 120,
        text: "Dark",
      },
    ],
  });
  const admin = await pageAs("admin");
  const adminProblems = watchConsole(admin);
  await openBoard(admin, board.id);
  const html = admin.locator("html");
  await admin.keyboard.press("ControlOrMeta+k");
  await admin.getByRole("option", { name: /^Dark theme/ }).click();
  try {
    await expect(html).toHaveClass(/\bdark\b/);
    // The canvas paints a dark background.
    await expect
      .poll(() =>
        admin.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            "[role='application'] canvas",
          );
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) return 255;
          const [r, g, b] = ctx.getImageData(5, canvas.height - 5, 1, 1).data;
          return Math.max(r ?? 0, g ?? 0, b ?? 0);
        }),
      )
      .toBeLessThan(80);
    await expectOnBoard(admin, "Dark");
  } finally {
    await admin.keyboard.press("ControlOrMeta+k");
    await admin.getByRole("option", { name: /^Light theme/ }).click();
    await expect(html).not.toHaveClass(/\bdark\b/);
  }
  expect(adminProblems).toEqual([]);
});

test("the toolbar works on a 390px phone", async ({ pageAs, api }) => {
  const board = await createBoard(api);
  const phone = await pageAs("member");
  const phoneProblems = watchConsole(phone);
  await phone.setViewportSize({ width: 390, height: 844 });
  const { at, box } = await openBoard(phone, board.id);
  const toolbar = phone.getByRole("toolbar", { name: "Tools" });
  await expect(toolbar).toBeVisible();
  const bar = await toolbar.boundingBox();
  expect(bar?.width ?? 0).toBeLessThanOrEqual(390);
  expect((bar?.x ?? -1) >= 0).toBe(true);

  // On a phone the shape button opens the library.
  await pickShape(phone, "Rectangle");
  await drag(phone, at(box.width / 2 - 60, 200), at(box.width / 2 + 60, 300));
  await expect
    .poll(
      async () => byType(await boardContent(api, board.id), "rectangle").length,
    )
    .toBe(1);
  expect(phoneProblems).toEqual([]);
});
