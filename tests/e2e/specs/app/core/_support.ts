import { deflateSync } from "node:zlib";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { type Actor, expect as baseExpect } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { readJson } from "../../../helpers/http";
import { uniqueName } from "../../../helpers/ui";

// Shared helpers for the app/core specs. Most mutating flows run as a freshly
// signed-up user in a workspace of their own, so they never touch the seeded
// "E2E Workspace", its memberships or the seeded accounts' preferences.

export type FreshUser = {
  id: string;
  name: string;
  email: string;
  password: string;
};

export type Workspace = { id: string; name: string; slug: string };

export type Project = {
  id: string;
  name: string;
  slug: string;
  workspaceId: string;
};

type PageAs = (actor: Actor) => Promise<Page>;

/**
 * `expect` with a 20 s default: the core specs run against shared dev servers
 * that other suites (and hot reloads) keep busy.
 */
export const expect = baseExpect.configure({ timeout: 20_000 });

const ORIGIN = { Origin: E2E_WEB_URL };

/** A unique, valid e-mail for an account created by a spec. */
export function uniqueEmail(prefix = "core"): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `e2e-${prefix}-${stamp}@margaya.test`;
}

/** A unique project key (letters only, at most 8 characters). */
export function uniqueKey(prefix = "Q"): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let key = prefix.toUpperCase();
  while (key.length < 6) {
    key += letters[Math.floor(Math.random() * letters.length)];
  }
  return key;
}

/** The first letter of each of the first two words, as the avatar shows it. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** Signs up through the public API; cookies land in `request`'s jar. */
export async function signUpViaApi(
  request: APIRequestContext,
  overrides: Partial<Omit<FreshUser, "id">> = {},
): Promise<FreshUser> {
  const user = {
    name: overrides.name ?? uniqueName("Core User").replace(/[^\w\s-]/g, ""),
    email: overrides.email ?? uniqueEmail(),
    password: overrides.password ?? "Core-Password-2026!",
  };
  const body = await readJson<{ user: { id: string } }>(
    await request.post(`${E2E_API_URL}/api/auth/sign-up/email`, {
      data: user,
      headers: ORIGIN,
    }),
    `sign up ${user.email}`,
  );
  return { ...user, id: body.user.id };
}

/** Creates a workspace owned by the signed-in user and makes it active. */
export async function createWorkspaceViaApi(
  request: APIRequestContext,
  name = uniqueName("Core WS"),
): Promise<Workspace> {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const workspace = await readJson<Workspace>(
    await request.post(`${E2E_API_URL}/api/auth/organization/create`, {
      data: { name, slug },
      headers: ORIGIN,
    }),
    `create workspace ${name}`,
  );
  await readJson(
    await request.post(`${E2E_API_URL}/api/auth/organization/set-active`, {
      data: { organizationId: workspace.id },
      headers: ORIGIN,
    }),
    "set active workspace",
  );
  return workspace;
}

export async function createProjectViaApi(
  request: APIRequestContext,
  workspaceId: string,
  { name = uniqueName("Core project"), slug = uniqueKey() } = {},
): Promise<Project> {
  const project = await readJson<{ id: string; name: string; slug: string }>(
    await request.post(`${E2E_API_URL}/api/project`, {
      data: { name, slug, workspaceId, icon: "Layout" },
      headers: ORIGIN,
    }),
    `create project ${name}`,
  );
  return { ...project, workspaceId };
}

export async function createTaskViaApi(
  request: APIRequestContext,
  projectId: string,
  { title = uniqueName("Core task"), status = "to-do" } = {},
): Promise<{ id: string; number: number; title: string }> {
  return readJson(
    await request.post(`${E2E_API_URL}/api/task/${projectId}`, {
      data: { title, description: "", priority: "medium", status },
      headers: ORIGIN,
    }),
    `create task ${title}`,
  );
}

export async function deleteProjectViaApi(
  request: APIRequestContext,
  projectId: string,
): Promise<void> {
  await request.delete(`${E2E_API_URL}/api/project/${projectId}`, {
    headers: ORIGIN,
  });
}

export type NewUserSession = {
  page: Page;
  user: FreshUser;
  workspace: Workspace;
};

/**
 * A browser page signed in as a brand-new user who owns a fresh workspace,
 * already opened on that workspace. The context closes with the test.
 */
export async function newUserWithWorkspace(
  pageAs: PageAs,
  { workspaceName }: { workspaceName?: string } = {},
): Promise<NewUserSession> {
  const page = await pageAs("anonymous");
  const user = await signUpViaApi(page.request);
  const workspace = await createWorkspaceViaApi(page.request, workspaceName);
  return { page, user, workspace };
}

export function workspacePath(workspaceId: string): string {
  return `/dashboard/workspace/${workspaceId}`;
}

/** The workspace's project list (the workspace root is Home). */
export function projectsPath(workspaceId: string): string {
  return `/dashboard/workspace/${workspaceId}/projects`;
}

export function boardPath(workspaceId: string, projectId: string): string {
  return `/dashboard/workspace/${workspaceId}/project/${projectId}/board`;
}

export function taskPath(
  workspaceId: string,
  projectId: string,
  taskId: string,
): string {
  return `/dashboard/workspace/${workspaceId}/project/${projectId}/task/${taskId}`;
}

/** The toast region's copy of a message (toasts render outside dialogs). */
export function toast(page: Page, text: string | RegExp): Locator {
  return page
    .locator("[data-sonner-toast], [role=status], [role=alert], li, div")
    .filter({ hasText: text })
    .last();
}

/** Waits until a toast with `text` is visible. */
export async function expectToast(
  page: Page,
  text: string | RegExp,
): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible();
}

/** The sidebar (the app's left navigation). */
/** The section panel beside the rail: on the projects page, the project list. */
export function sidebar(page: Page): Locator {
  return page.getByRole("complementary", { name: "Section navigation" });
}

/** Opens the "More" menu of a sidebar row whose button reads `name`. */
export async function openSidebarRowMenu(
  page: Page,
  group: Locator,
  name: string,
): Promise<void> {
  const row = group.locator("li").filter({
    has: page.getByRole("button", { name, exact: true }),
  });
  await row.hover();
  await row.getByRole("button", { name: "More" }).click();
}

/**
 * Drags `source` onto `target` with real mouse moves (dnd-kit needs the
 * pointer to travel past its 8px activation distance).
 */
export async function dragTo(
  page: Page,
  source: Locator,
  target: Locator,
): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("drag source or target is not visible");
  const startX = from.x + from.width / 3;
  const startY = from.y + from.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 10, { steps: 5 });
  const endY = to.y + to.height / 2 + (to.y > from.y ? 6 : -6);
  await page.mouse.move(startX, endY, { steps: 20 });
  await page.mouse.move(startX, endY + (to.y > from.y ? 2 : -2), { steps: 3 });
  await page.mouse.up();
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A solid-colour RGB PNG, for avatar uploads. */
export function solidPng(
  size = 64,
  rgb: [number, number, number] = [200, 40, 90],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.alloc(size * 3).map((_, index) => rgb[index % 3] ?? 0),
  ]);
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
