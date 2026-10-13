import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect as baseExpect } from "../../../fixtures";
import { eventually } from "../../../helpers/api-kit";
import { loadSeedManifest } from "../../../helpers/auth";
import { readJson } from "../../../helpers/http";

// Shared helpers for the app/features specs: Pages, drafts and archives,
// intake, analytics, exports and imports. Every test creates its own project
// (helpers/task-data.ts) and removes it afterwards.

/**
 * `expect` with a 20 s default: these specs run against shared dev servers
 * that other suites keep busy.
 */
export const expect = baseExpect.configure({ timeout: 20_000 });

export function workspaceId(): string {
  return loadSeedManifest().workspace.id;
}

export function projectPath(projectId: string, section: string): string {
  return `/dashboard/workspace/${workspaceId()}/project/${projectId}/${section}`;
}

export function workspaceSectionPath(section: string): string {
  return `/dashboard/workspace/${workspaceId()}/${section}`;
}

export async function setFeatures(
  api: APIRequestContext,
  projectId: string,
  features: Record<string, boolean>,
): Promise<void> {
  await readJson(
    await api.patch(`/api/project/${projectId}/features`, { data: features }),
    "update project features",
  );
}

// ---- Pages ----

export type TestPage = {
  id: string;
  title: string;
  parentId: string | null;
  projectId: string | null;
  access: "public" | "private";
  isLocked: boolean;
  archivedAt: string | null;
  contentMarkdown: string;
};

export async function createPage(
  api: APIRequestContext,
  projectId: string,
  body: {
    title?: string;
    parentId?: string;
    content?: string;
    access?: "public" | "private";
  } = {},
): Promise<TestPage> {
  return readJson<TestPage>(
    await api.post(`/api/page/project/${projectId}`, { data: body }),
    `create page ${body.title ?? ""}`,
  );
}

export async function getPage(
  api: APIRequestContext,
  pageId: string,
): Promise<TestPage> {
  return readJson<TestPage>(await api.get(`/api/page/${pageId}`), "get page");
}

export async function replacePageContent(
  api: APIRequestContext,
  pageId: string,
  markdown: string,
): Promise<void> {
  await readJson(
    await api.put(`/api/page/${pageId}/content`, { data: { markdown } }),
    "replace page content",
  );
}

/** Polls the stored page until `predicate` holds (live edits save async). */
export function waitForStoredPage(
  api: APIRequestContext,
  pageId: string,
  predicate: (page: TestPage) => boolean,
  what = "the stored page",
): Promise<TestPage> {
  return eventually(
    async () => {
      const stored = await getPage(api, pageId);
      return predicate(stored) ? stored : undefined;
    },
    { timeoutMs: 30_000, intervalMs: 500, what },
  );
}

export function pagePath(projectId: string, pageId: string, search = "") {
  return `${projectPath(projectId, `pages/${pageId}`)}${search}`;
}

/** The page body (Tiptap, live through the page socket). */
export function pageEditor(page: Page): Locator {
  return page.locator(".ProseMirror[aria-label='Page content']");
}

/** Opens a page and waits until its body is editable (or read-only). */
export async function openPageScreen(
  page: Page,
  projectId: string,
  pageId: string,
  {
    search = "",
    editable = true,
  }: { search?: string; editable?: boolean } = {},
): Promise<void> {
  const editor = pageEditor(page);
  // The shared dev server sometimes stalls a cold load; reload once.
  await expect(async () => {
    await page.goto(pagePath(projectId, pageId, search), {
      waitUntil: "domcontentloaded",
    });
    await expect(editor).toBeVisible({ timeout: 60_000 });
  }).toPass({ timeout: 150_000 });
  if (editable) {
    // The body turns editable once the live document has synced.
    await expect(editor).toHaveAttribute("contenteditable", "true", {
      timeout: 60_000,
    });
  }
}

/**
 * Types a page title and presses Enter until the server has it: right after
 * a page opens, its title input can re-mount and drop what was typed.
 */
export async function setPageTitle(
  page: Page,
  api: APIRequestContext,
  pageId: string,
  title: string,
): Promise<void> {
  const input = page.getByLabel("Page title");
  await expect(async () => {
    await expect(input).toBeEditable({ timeout: 10_000 });
    await input.fill(title);
    await input.press("Enter");
    await expect
      .poll(async () => (await getPage(api, pageId)).title, {
        timeout: 8_000,
      })
      .toBe(title);
  }).toPass({ timeout: 90_000 });
}

/** The header's sync badge reads "Saved" once the server has the edit. */
export function savedBadge(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: "Saved" });
}

/** A treeitem of the page tree. */
export function treeItem(page: Page, title: string): Locator {
  return page
    .getByRole("tree", { name: "Pages" })
    .getByRole("treeitem", { name: title, exact: true });
}

// ---- Tasks ----

export async function archiveTask(
  api: APIRequestContext,
  taskId: string,
): Promise<void> {
  await readJson(await api.post(`/api/task/archive/${taskId}`), "archive task");
}

export function toastText(page: Page, text: string | RegExp): Locator {
  return page
    .getByRole("region", { name: "Notifications" })
    .getByText(text)
    .first();
}
