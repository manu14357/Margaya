import { expect, type Locator, type Page } from "@playwright/test";

// UI helpers for the task, board and planning specs.

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A task card on the board (or a row in the list view): dnd-kit renders each
 * as a button whose accessible name holds the key, assignees and title.
 */
export function taskCard(scope: Page | Locator, title: string): Locator {
  return scope.getByRole("button", {
    name: new RegExp(escapeRegExp(title)),
  });
}

/** A board column: a region landmark named after the column. */
export function boardColumn(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

/**
 * Board capabilities load asynchronously (one has-permission call each);
 * editing controls appear once they resolve.
 */
export async function waitForBoardReady(page: Page): Promise<void> {
  await expect(
    page.getByRole("button", { name: "Add task" }).first(),
  ).toBeVisible({ timeout: 60_000 });
  // The Board/List choice is a per-user preference kept on the server, so a
  // spec that switched the shared owner to List leaves later specs in List.
  const listTab = layoutTab(page, "List");
  if (
    (await listTab.count()) > 0 &&
    (await listTab.getAttribute("aria-selected")) === "true"
  ) {
    await restoreBoardLayout(page);
  }
  // A cycle or module page has the same choice as a switch in its toolbar.
  const board = page
    .getByRole("group", { name: "Layout" })
    .getByRole("button", { name: "Board", exact: true });
  if (
    (await board.count()) > 0 &&
    (await board.first().getAttribute("aria-pressed")) === "false"
  ) {
    await board.first().click();
    await expect(board.first()).toHaveAttribute("aria-pressed", "true");
  }
}

/**
 * Switch a board back to the Board layout at the end of a spec that chose
 * List, so the owner's synced preference does not leak into specs running
 * alongside.
 */
export async function restoreBoardLayout(page: Page): Promise<void> {
  await layoutTab(page, "Board").click();
  await expect(layoutTab(page, "Board")).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

/**
 * Drag with small mouse steps so dnd-kit's pointer sensor activates (it needs
 * 8px of movement before a drag starts).
 */
export async function dragAndDrop(
  page: Page,
  source: Locator,
  target: Locator,
  {
    targetPosition = "center",
  }: { targetPosition?: "center" | "top" | "bottom" } = {},
): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  if (!from) throw new Error("drag source is not visible");
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 4, startY + 4, { steps: 4 });
  await page.mouse.move(startX + 12, startY + 12, { steps: 4 });
  const to = await target.boundingBox();
  if (!to) throw new Error("drop target is not visible");
  const endX = to.x + to.width / 2;
  const endY =
    targetPosition === "top"
      ? to.y + Math.min(12, to.height / 4)
      : targetPosition === "bottom"
        ? to.y + to.height - Math.min(8, to.height / 4)
        : to.y + to.height / 2;
  await page.mouse.move(endX, endY, { steps: 25 });
  await page.mouse.move(endX, endY + 1, { steps: 2 });
  await page.mouse.up();
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/** The accessible name react-day-picker gives a day, e.g. "September 28th, 2026". */
export function dayLabel(date: Date): RegExp {
  return new RegExp(
    `${MONTHS[date.getMonth()]} ${ordinal(date.getDate())}, ${date.getFullYear()}`,
  );
}

/** Local noon, `offsetDays` from today. */
export function localDay(offsetDays: number): Date {
  const day = new Date();
  day.setHours(12, 0, 0, 0);
  day.setDate(day.getDate() + offsetDays);
  return day;
}

/** Click a day in an open react-day-picker calendar, paging months as needed. */
export async function pickCalendarDay(scope: Locator | Page, date: Date) {
  const day = scope.getByRole("button", { name: dayLabel(date) });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await day.first().isVisible()) break;
    const next = scope.getByRole("button", { name: /next month/i });
    await next.first().click();
  }
  await day.first().click();
}

/** "Sep 28" (the card and sidebar short date). */
export function shortDate(date: Date): string {
  return `${(MONTHS[date.getMonth()] ?? "").slice(0, 3)} ${date.getDate()}`;
}

/** YYYY-MM-DD of a Date in local time. */
export function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The local calendar day an API timestamp falls on. */
export function localYmd(iso: string | null | undefined): string | null {
  return iso ? ymd(new Date(iso)) : null;
}

/** The most recently opened popover (Base UI renders it in a portal). */
export function openPopover(page: Page): Locator {
  return page.locator("[data-slot='popover-popup'][data-open]").last();
}

/** Which of `titles` are shown as buttons (cards or rows) in `scope`, in DOM order. */
export function titlesInOrder(
  scope: Locator | Page,
  titles: string[],
): Promise<string[]> {
  return scope.getByRole("button").evaluateAll(
    (elements, wanted) =>
      // Query-mode cards nest two buttons; keep each title's first hit.
      [
        ...new Set(
          elements
            .map((element) =>
              wanted.find((title) => element.textContent?.includes(title)),
            )
            .filter((title): title is string => Boolean(title)),
        ),
      ],
    titles,
  );
}

/** The create-task modal (popovers are dialogs too, so match its title field). */
export function createTaskDialog(page: Page): Locator {
  return page
    .getByRole("dialog")
    .filter({ has: page.getByPlaceholder("Task title") });
}

/** Press Escape until no menu or popover is open (at most three times). */
export async function closeMenus(page: Page): Promise<void> {
  // Base UI marks open popups with data-open; closing ones lose it at once.
  const open = page.locator(
    "[data-slot='menu-popup'][data-open], [data-slot='popover-popup'][data-open], [data-slot='context-menu-content'][data-open]",
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await open.count();
    if (before === 0) return;
    await page.keyboard.press("Escape");
    await expect
      .poll(() => open.count(), { timeout: 2_000 })
      .toBeLessThan(before)
      .catch(() => undefined);
  }
  await expect(open).toHaveCount(0);
}

/**
 * Close open popovers by clicking `outside` (inside a sheet, Escape can close
 * the sheet itself when focus has fallen back to the page).
 */
export async function dismissPopover(page: Page, outside: Locator) {
  const open = page.locator("[data-slot='popover-popup'][data-open]");
  await expect(async () => {
    if ((await open.count()) === 0) return;
    await outside.click({ position: { x: 2, y: 2 } });
    await expect(open).toHaveCount(0, { timeout: 1_500 });
  }).toPass({ timeout: 10_000 });
}

/** A project's layout tab ("Board", "List", "Spreadsheet", ...). */
export function layoutTab(page: Page, name: string): Locator {
  return page.getByRole("main").getByRole("tab", { name, exact: true });
}

/** A board toolbar button ("Filter", "Sort", or a cycle page's "List"). */
export function toolbarButton(page: Page, name: string): Locator {
  return page
    .getByRole("main")
    .getByRole("button", { name, exact: true })
    .last();
}

/** Opens the board's Display popover and returns it. */
export async function openDisplayMenu(page: Page): Promise<Locator> {
  await page
    .getByRole("main")
    .getByRole("button", { name: "Display", exact: true })
    .first()
    .click();
  const popover = openPopover(page);
  await expect(popover.getByText("Order by", { exact: true })).toBeVisible();
  return popover;
}

/** Opens Filter > `subject` and returns the submenu. */
export async function openFilterSubmenu(
  page: Page,
  subject: string,
): Promise<Locator> {
  await page
    .getByRole("main")
    .getByRole("button", { name: "Filter", exact: true })
    .first()
    .click();
  // A subject with selected values shows their count: "Priority 2".
  await page
    .getByRole("menuitem", {
      name: new RegExp(`^${escapeRegExp(subject)}( \\d+)?$`),
    })
    .click();
  const submenu = page.getByRole("menu").last();
  await expect(submenu).toBeVisible();
  return submenu;
}

/**
 * Open a task's full page and wait until editing is possible: the quick
 * actions under the description only render once permissions have loaded.
 */
export async function openTaskPage(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("button", { name: "Add subtask" })).toBeVisible({
    timeout: 60_000,
  });
}

/** The task sheet that opens over the board. */
export function taskSheet(page: Page): Locator {
  return page.getByRole("dialog").filter({
    has: page.getByRole("textbox", { name: "Click to add a title" }),
  });
}

/**
 * Replace the text of a Tiptap editor. Retries when the editor re-mounts
 * mid-typing (focus jumps away and keystrokes are lost).
 */
export async function fillRichText(editor: Locator, text: string) {
  await expect(async () => {
    await editor.click();
    await editor.press("ControlOrMeta+a");
    await editor.press("Backspace");
    await editor.pressSequentially(text);
    await expect(editor).toHaveText(text, { timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
}

/** Text of a toast in the notifications region. */
export function toast(page: Page, text: string | RegExp): Locator {
  // Identical toasts can stack (two quick actions); any one will do.
  return page
    .getByRole("region", { name: "Notifications" })
    .getByText(text)
    .first();
}
