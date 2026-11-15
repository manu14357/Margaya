import { readFileSync } from "node:fs";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { eventually } from "../../../helpers/api-kit";
import { authFile } from "../../../helpers/auth";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { createApiContext, readJson } from "../../../helpers/http";
import {
  createProject,
  deleteProject,
  type TestProject,
} from "../../../helpers/task-data";
import { uniqueName } from "../../../helpers/ui";
import { solidPng } from "../core/_support";
import { expect, projectPath } from "./_support";

// Whiteboard fixes found in exploratory testing: text boxes that fit a new
// font, input methods, the text field that must not scroll, the Style panel
// on mixed selections, dropped and pasted files, images that move with
// copies and board files, the "?" key, arrows on a focused button, the Text
// tool on existing text and going offline. Every test works in a project
// this file creates.

type Element = Record<string, unknown> & {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
  project = await createProject(api, { name: uniqueName("Board QA") });
  await api.dispose();
});

test.afterAll(async () => {
  const api = await ownerApi();
  if (project) await deleteProject(api, project.id);
  await api.dispose();
});

async function createBoard(
  api: APIRequestContext,
  elements: Record<string, unknown>[] = [],
): Promise<{ id: string; title: string }> {
  return readJson(
    await api.post("/api/whiteboard", {
      data: { projectId: project.id, title: uniqueName("QA board"), elements },
    }),
    "create whiteboard",
  );
}

async function content(
  api: APIRequestContext,
  boardId: string,
): Promise<Element[]> {
  const body = await readJson<{ elements: Element[] }>(
    await api.get(`/api/whiteboard/${boardId}/content`),
    "whiteboard content",
  );
  return body.elements;
}

async function openBoard(page: Page, boardId: string) {
  await page.goto(projectPath(project.id, `whiteboards/${boardId}`));
  const canvas = page.getByRole("application", { name: "Whiteboard canvas" });
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the whiteboard canvas has no box");
  return { canvas, box };
}

function tool(page: Page, name: string): Locator {
  return page
    .getByRole("toolbar", { name: "Tools" })
    .getByRole("button", { name, exact: true });
}

function stylePanel(page: Page): Locator {
  return page.getByRole("region", { name: "Style" });
}

async function selectAll(page: Page) {
  await page.getByRole("application", { name: "Whiteboard canvas" }).focus();
  await page.keyboard.press("ControlOrMeta+a");
}

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
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

/** Dispatches a file drop on the canvas, as a drag from the desktop does. */
async function dropFile(
  page: Page,
  file: { name: string; type: string; bytes: Buffer },
) {
  await page.evaluate(
    ({ name, type, data }) => {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type }));
      const target = document.querySelector("[data-testid=whiteboard-editor]");
      const box = target?.getBoundingClientRect();
      const init = {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
        clientX: (box?.x ?? 0) + (box?.width ?? 0) / 2,
        clientY: (box?.y ?? 0) + (box?.height ?? 0) / 2,
      };
      target?.dispatchEvent(new DragEvent("dragover", init));
      target?.dispatchEvent(new DragEvent("drop", init));
    },
    { name: file.name, type: file.type, data: file.bytes.toString("base64") },
  );
}

/** An image uploaded to the board through the toolbar's Image button. */
async function addImage(page: Page, api: APIRequestContext, boardId: string) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    tool(page, "Image").click(),
  ]);
  await chooser.setFiles({
    name: "square.png",
    mimeType: "image/png",
    buffer: solidPng(96),
  });
  return eventually(
    async () =>
      (await content(api, boardId)).find(
        (element) => element.type === "image" && element.assetId,
      ),
    { what: "the uploaded image" },
  );
}

async function assetLoads(
  api: APIRequestContext,
  boardId: string,
  assetId: unknown,
) {
  const response = await api.get(
    `/api/whiteboard/${boardId}/assets/${String(assetId)}`,
  );
  return response.ok();
}

test("a new font size or font refits a text box to its words", async ({
  page,
  api,
}) => {
  const board = await createBoard(api, [
    {
      id: "qa-text-1",
      type: "text",
      x: 0,
      y: 0,
      width: 60,
      height: 25,
      text: "Grow me please",
      autoSize: true,
      fontSize: 20,
      fontFamily: "sans",
    },
  ]);
  await openBoard(page, board.id);
  await selectAll(page);
  const before = (await content(api, board.id))[0] as Element;
  await stylePanel(page).getByRole("button", { name: "XL" }).click();
  const after = await eventually(
    async () => {
      const text = (await content(api, board.id))[0];
      return text?.fontSize === 40 ? text : undefined;
    },
    { what: "the larger text" },
  );
  expect(after.width).toBeGreaterThan(before.width * 1.5);
  expect(after.height).toBe(50);
});

test("Escape that cancels an input method's composition keeps the text editor open", async ({
  page,
  api,
  context,
}) => {
  const board = await createBoard(api);
  const { box } = await openBoard(page, board.id);
  await tool(page, "Text").click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const editor = page.getByRole("textbox", { name: "Text", exact: true });
  await expect(editor).toBeFocused();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "にほんご",
    selectionStart: 4,
    selectionEnd: 4,
  });
  // The key an input method reports while it composes.
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 229,
    nativeVirtualKeyCode: 229,
  });
  await expect(editor).toBeVisible();
  await cdp.send("Input.insertText", { text: "日本語" });
  await page.keyboard.insertText(" हिंदी 😀");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect
    .poll(async () => (await content(api, board.id))[0]?.text)
    .toBe("日本語 हिंदी 😀");
});

test("the text editor of a sticky note never scrolls its words", async ({
  page,
  api,
}) => {
  const board = await createBoard(api, [
    {
      id: "qa-sticky-1",
      type: "sticky",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      text: "The quick brown fox jumps over the lazy dog again and again",
      fontFamily: "hand",
      fontSize: 20,
    },
  ]);
  await openBoard(page, board.id);
  await selectAll(page);
  await page.keyboard.press("Enter");
  const editor = page.getByRole("textbox", { name: "Text", exact: true });
  await expect(editor).toBeFocused();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" and more");
  expect(await editor.evaluate((field) => field.scrollTop)).toBe(0);
  await page.keyboard.press("Escape");
});

test("the Style panel on a shape and a sticky note changes only what each option applies to", async ({
  page,
  api,
}) => {
  const board = await createBoard(api, [
    {
      id: "qa-rect-1",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 160,
      height: 100,
      strokeWidth: 4,
    },
    {
      id: "qa-note-1",
      type: "sticky",
      x: 220,
      y: 0,
      width: 160,
      height: 160,
      text: "note",
    },
  ]);
  await openBoard(page, board.id);
  await selectAll(page);
  const panel = stylePanel(page);
  // The note has no outline of its own, so the shape's width shows.
  await expect(
    panel.getByRole("button", { name: "Bold", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const noteBefore = (await content(api, board.id)).find(
    (element) => element.type === "sticky",
  );
  await panel
    .getByRole("group", { name: "Background" })
    .getByRole("button", { name: "Red" })
    .click();
  await panel
    .getByRole("group", { name: "Stroke" })
    .getByRole("button", { name: "Blue" })
    .click();
  await eventually(
    async () => {
      const rect = (await content(api, board.id)).find(
        (element) => element.type === "rectangle",
      );
      return (
        rect?.fillColor !== "transparent" && rect?.strokeColor === "#2563eb"
      );
    },
    { what: "the restyled shape" },
  );
  const note = (await content(api, board.id)).find(
    (element) => element.type === "sticky",
  );
  expect(note?.fillColor).toBe(noteBefore?.fillColor);
  expect(note?.strokeColor).toBe(noteBefore?.strokeColor);
});

test("dropped files: a plain PNG becomes an image quietly, a PDF is refused clearly", async ({
  page,
  api,
}) => {
  const board = await createBoard(api);
  await openBoard(page, board.id);
  await dropFile(page, {
    name: "photo.png",
    type: "image/png",
    bytes: solidPng(48),
  });
  await eventually(
    async () =>
      (await content(api, board.id)).some(
        (element) => element.type === "image" && element.assetId,
      ),
    { what: "the dropped image" },
  );
  await expect(page.getByText("That file is not a Margaya board.")).toHaveCount(
    0,
  );
  await dropFile(page, {
    name: "notes.pdf",
    type: "application/pdf",
    bytes: Buffer.from("%PDF-1.4"),
  });
  await expect(
    page.getByText("Only PNG, JPEG, GIF and WebP images can go on a board"),
  ).toBeVisible();
  expect(await content(api, board.id)).toHaveLength(1);
});

test("an image copied to another board is uploaded there and shows", async ({
  page,
  api,
}) => {
  const source = await createBoard(api);
  const target = await createBoard(api);
  await openBoard(page, source.id);
  const original = await addImage(page, api, source.id);
  await selectAll(page);
  await page.keyboard.press("ControlOrMeta+c");
  await openBoard(page, target.id);
  await page.getByRole("application", { name: "Whiteboard canvas" }).focus();
  await page.keyboard.press("ControlOrMeta+v");
  const pasted = await eventually(
    async () =>
      (await content(api, target.id)).find(
        (element) => element.type === "image" && element.assetId,
      ),
    { what: "the pasted image" },
  );
  expect(pasted.assetId).not.toBe(original.assetId);
  expect(await assetLoads(api, target.id, pasted.assetId)).toBe(true);
});

test("a board file carries its images to another board, with one message", async ({
  page,
  api,
}) => {
  const source = await createBoard(api);
  const target = await createBoard(api);
  await openBoard(page, source.id);
  const original = await addImage(page, api, source.id);
  await page.getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Download board file" }).click(),
  ]);
  const file = readFileSync(await download.path());
  expect(Object.keys(JSON.parse(file.toString("utf8")).images)).toEqual([
    original.assetId,
  ]);

  await openBoard(page, target.id);
  await page.getByRole("button", { name: "More board options" }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("menuitem", { name: "Import board file" }).click(),
  ]);
  await chooser.setFiles({
    name: "board.margaya-board",
    mimeType: "application/json",
    buffer: file,
  });
  const imported = await eventually(
    async () =>
      (await content(api, target.id)).find(
        (element) => element.type === "image" && element.assetId,
      ),
    { what: "the imported image" },
  );
  expect(imported.assetId).not.toBe(original.assetId);
  expect(await assetLoads(api, target.id, imported.assetId)).toBe(true);
  await expect(page.getByText("Board file added")).toBeVisible();
  await expect(page.getByText("Board added", { exact: true })).toHaveCount(0);
});

test("? opens only the board's keyboard shortcuts", async ({ page, api }) => {
  const board = await createBoard(api);
  await openBoard(page, board.id);
  await page.getByRole("application", { name: "Whiteboard canvas" }).focus();
  await page.keyboard.press("Shift+?");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toContainText("Mouse and touch");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Ctrl+Shift+arrow aligns right after a Style panel button was used", async ({
  page,
  api,
}) => {
  const board = await createBoard(api, [
    { id: "qa-a", type: "rectangle", x: 0, y: 0, width: 100, height: 60 },
    { id: "qa-b", type: "rectangle", x: 260, y: 120, width: 60, height: 60 },
  ]);
  await openBoard(page, board.id);
  await selectAll(page);
  await stylePanel(page)
    .getByRole("button", { name: "Bring to front" })
    .click();
  await page.keyboard.press("ControlOrMeta+Shift+ArrowLeft");
  await expect
    .poll(async () => (await content(api, board.id)).map((e) => e.x))
    .toEqual([0, 0]);
});

test("the Text tool edits the text it clicks instead of stacking a new one", async ({
  page,
  api,
}) => {
  const board = await createBoard(api, [
    {
      id: "qa-words",
      type: "text",
      x: 0,
      y: 0,
      width: 200,
      height: 50,
      text: "existing words",
      autoSize: true,
      fontSize: 40,
    },
  ]);
  const { box } = await openBoard(page, board.id);
  await tool(page, "Text").click();
  // A board with one element is fitted around it, in the middle.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const editor = page.getByRole("textbox", { name: "Text", exact: true });
  await expect(editor).toHaveValue("existing words");
  await page.keyboard.press("End");
  await page.keyboard.type(" here");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await content(api, board.id)).map((e) => e.text))
    .toEqual(["existing words here"]);
});

test("going offline shows Offline at once, and offline edits arrive after reconnecting", async ({
  page,
  api,
  context,
}) => {
  const board = await createBoard(api);
  const { box } = await openBoard(page, board.id);
  // A first edit, so the board has synced.
  await tool(page, "Sticky note").click();
  await page.mouse.click(box.x + box.width / 2 - 200, box.y + box.height / 2);
  const editor = page.getByRole("textbox", { name: "Text", exact: true });
  await expect(editor).toBeFocused();
  await page.keyboard.type("online");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await content(api, board.id)).length).toBe(1);

  await context.setOffline(true);
  try {
    await expect(page.getByText("Offline", { exact: true })).toBeVisible({
      timeout: 5_000,
    });
    await tool(page, "Sticky note").click();
    await page.mouse.click(box.x + box.width / 2 + 200, box.y + box.height / 2);
    await expect(editor).toBeFocused();
    await page.keyboard.type("made offline");
    await page.keyboard.press("Escape");
    expect(await content(api, board.id)).toHaveLength(1);
  } finally {
    await context.setOffline(false);
  }
  await expect
    .poll(
      async () => (await content(api, board.id)).map((e) => e.text).sort(),
      {
        timeout: 30_000,
      },
    )
    .toEqual(["made offline", "online"]);
  await expect(page.getByText("Offline", { exact: true })).toHaveCount(0);
});
