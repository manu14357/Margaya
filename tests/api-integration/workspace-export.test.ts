import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { encodeScope } from "../../apps/api/src/api-key/scope";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  resolveLocalPath,
  writeLocalObject,
} from "../../apps/api/src/storage/local";
import { runExportCleanup } from "../../apps/api/src/task-export/cleanup";
import { WORKSPACE_EXPORT_RUNNING } from "../../apps/api/src/task-export/controllers/create-workspace-export";
import { ZipFileWriter } from "../../apps/api/src/task-export/encoders/zip-file";
import {
  EXPORT_FAILED,
  REQUESTER_GONE,
} from "../../apps/api/src/task-export/job";
import {
  startExportRunner,
  stopExportRunner,
  WORKSPACE_DATABASE_STORAGE_TOO_LARGE,
} from "../../apps/api/src/task-export/runner";
import { exportLimits } from "../../apps/api/src/task-export/settings";
import { WORKSPACE_EXPORT_PERMISSIONS } from "../../apps/api/src/task-export/types";
import {
  entrySegment,
  WORKSPACE_EXPORT_TOO_LARGE,
} from "../../apps/api/src/workspace-export/build";
import { addUserConnection, removeUserConnection } from "../../apps/api/src/ws";
import { readZip } from "../api/task-export/helpers/read-zip";
import { createApiKey } from "./helpers/api-keys";
import { auditEntry } from "./helpers/audit-log";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture } from "./helpers/fixtures";
import {
  drainExports,
  type ExportJson,
  type ExportPageJson,
  exportRow,
  exportScene,
} from "./helpers/task-exports";

const DAY_MS = 24 * 60 * 60 * 1000;
const limits = { ...exportLimits };
let storageDir: string;

beforeEach(async () => {
  stopExportRunner();
  await resetTestDatabase();
  storageDir = await mkdtemp(path.join(tmpdir(), "margaya-workspace-export-"));
  vi.stubEnv("MARGAYA_LOCAL_STORAGE", "true");
  vi.stubEnv("MARGAYA_STORAGE_DIR", storageDir);
});

afterEach(async () => {
  Object.assign(exportLimits, limits);
  vi.unstubAllEnvs();
  await rm(storageDir, { recursive: true, force: true });
});

afterAll(() => {
  startExportRunner();
});

type Scene = Awaited<ReturnType<typeof exportScene>>;
type User = Scene["mia"];

const start = (s: Scene, user: User, includeFiles = true) =>
  s.as(user)("POST", "/task-export/workspace", {
    workspaceId: s.workspaceId,
    includeFiles,
  });

async function startOk(s: Scene, user: User, includeFiles = true) {
  const response = await start(s, user, includeFiles);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as ExportJson;
}

/** Starts, runs and downloads an export; returns the row and its entries. */
async function runAndRead(s: Scene, user: User, includeFiles = true) {
  const started = await startOk(s, user, includeFiles);
  await drainExports();
  const row = await exportRow(started.id);
  expect(row?.error ?? null).toBeNull();
  expect(row?.status).toBe("completed");
  const archive = await s.download(user, started.id);
  const entries = new Map(
    readZip(archive).map((entry) => [entry.name, entry.data]),
  );
  const json = <T = Record<string, never>>(name: string) => {
    const data = entries.get(name);
    if (!data) throw new Error(`${name} is not in the archive`);
    return JSON.parse(data.toString("utf8")) as T;
  };
  return { row, archive, entries, json, id: started.id };
}

async function addAsset(
  s: Scene,
  values: Partial<typeof schema.assetTable.$inferInsert> & { filename: string },
  bytes?: string,
) {
  const objectKey = `attachments/${randomUUID()}.bin`;
  const [asset] = await db
    .insert(schema.assetTable)
    .values({
      workspaceId: s.workspaceId,
      projectId: s.web.project.id,
      objectKey,
      mimeType: "application/octet-stream",
      size: bytes?.length ?? 4,
      kind: "file",
      surface: "attachment",
      ...values,
    })
    .returning();
  if (!asset) throw new Error("Failed to create the asset");
  if (bytes !== undefined) {
    await writeLocalObject(objectKey, Buffer.from(bytes), {
      contentType: "application/octet-stream",
      maxBytes: bytes.length,
    });
  }
  return asset;
}

async function addPage(
  s: Scene,
  values: Partial<typeof schema.pageTable.$inferInsert> = {},
) {
  const [page] = await db
    .insert(schema.pageTable)
    .values({
      workspaceId: s.workspaceId,
      projectId: s.web.project.id,
      title: "Handbook",
      contentMarkdown: "# Welcome",
      ownerId: s.mia.id,
      ...values,
    })
    .returning();
  if (!page) throw new Error("Failed to create the page");
  return page;
}

async function addComment(
  taskId: string,
  userId: string,
  content: string,
  parentId?: string,
) {
  const [comment] = await db
    .insert(schema.activityTable)
    .values({ taskId, userId, type: "comment", content, parentId })
    .returning();
  if (!comment) throw new Error("Failed to create the comment");
  return comment;
}

async function setRole(userId: string, role: string) {
  await db
    .update(schema.workspaceUserTable)
    .set({ role })
    .where(eq(schema.workspaceUserTable.userId, userId));
}

/** A custom role that has `permission`, stored as the roles editor stores it. */
async function addRole(
  s: Scene,
  role: string,
  permission: Record<string, string[]>,
) {
  await db.insert(schema.workspaceRoleTable).values({
    workspaceId: s.workspaceId,
    role,
    permission: JSON.stringify(permission),
  });
}

describe("POST /task-export/workspace", () => {
  it("is for workspace admins and owners only", async () => {
    const s = await exportScene();
    for (const user of [s.mia, s.vic, s.outsider]) {
      expect((await start(s, user)).status).toBe(403);
    }
    const byAdmin = await start(s, s.ada);
    expect(byAdmin.status).toBe(200);
    expect(await byAdmin.json()).toMatchObject({
      kind: "workspace",
      format: "json",
      includeFiles: true,
      status: "queued",
      fileCount: null,
    });
    await drainExports();
    expect((await start(s, s.owner)).status).toBe(200);
  });

  it("allows one whole-workspace export at a time per workspace", async () => {
    const s = await exportScene();
    await startOk(s, s.ada);
    const second = await start(s, s.owner);
    expect(second.status).toBe(409);
    expect(await second.text()).toContain(WORKSPACE_EXPORT_RUNNING);

    await drainExports();
    expect((await start(s, s.owner)).status).toBe(200);
  });

  it("lets only one of two admins starting at the same moment through", async () => {
    const s = await exportScene();
    // API keys: each request authenticates as its own person, unlike `s.as`.
    const { app } = createApp();
    const startWith = async (user: User) => {
      const { headers } = await createApiKey(user);
      return () =>
        app.request("/api/task-export/workspace", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ workspaceId: s.workspaceId }),
        });
    };
    const starts = [await startWith(s.ada), await startWith(s.owner)];
    const statuses = (await Promise.all(starts.map((go) => go()))).map(
      (response) => response.status,
    );

    expect(statuses.sort()).toEqual([200, 409]);
    const rows = await db
      .select({ id: schema.taskExportTable.id })
      .from(schema.taskExportTable)
      .where(eq(schema.taskExportTable.workspaceId, s.workspaceId));
    expect(rows).toHaveLength(1);
  });

  it("is refused to guests, and reads as missing", async () => {
    const s = await exportScene();
    const { id } = await runAndRead(s, s.ada);
    await setRole(s.mia.id, "guest");

    expect((await start(s, s.mia)).status).toBe(404);
    for (const route of [`/task-export/${id}`, `/task-export/${id}/download`]) {
      expect((await s.as(s.mia)("GET", route)).status).toBe(404);
    }
    expect((await s.as(s.mia)("DELETE", `/task-export/${id}`)).status).toBe(
      404,
    );
  });

  it("takes a key that can do all of it, not a limited one", async () => {
    const s = await exportScene();
    const { app } = createApp();
    const startWith = (headers: Record<string, string>) =>
      app.request("/api/task-export/workspace", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: s.workspaceId }),
      });

    const readOnly = await createApiKey(
      s.ada,
      encodeScope({ access: "read" }) ?? undefined,
    );
    expect((await startWith(readOnly.headers)).status).toBe(403);

    const oneProject = await createApiKey(
      s.ada,
      encodeScope({ access: "full", projectIds: [s.web.project.id] }) ??
        undefined,
    );
    expect((await startWith(oneProject.headers)).status).toBe(403);

    const settingsOnly = await createApiKey(s.ada, {
      workspace: ["read", "manage_settings"],
    });
    expect((await startWith(settingsOnly.headers)).status).toBe(403);

    const full = await createApiKey(s.ada);
    const started = await startWith(full.headers);
    expect(started.status).toBe(200);
    const { id } = (await started.json()) as ExportJson;
    await drainExports();
    const download = await app.request(`/api/task-export/${id}/download`, {
      headers: full.headers,
    });
    expect(download.status).toBe(200);
    await download.arrayBuffer();
    expect(
      (
        await app.request(`/api/task-export/${id}/download`, {
          headers: oneProject.headers,
        })
      ).status,
    ).toBe(403);
  });

  it("is open to an instance admin, who need not be a member", async () => {
    const s = await exportScene();
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, s.outsider.id));

    const { row } = await runAndRead(s, s.outsider);
    expect(row).toMatchObject({ kind: "workspace", status: "completed" });
  });

  it("is recorded in the audit log when started and downloaded", async () => {
    const s = await exportScene();
    const { id } = await runAndRead(s, s.ada);

    expect(await auditEntry(s.workspaceId, "export.created")).toMatchObject({
      targetType: "export",
      targetId: id,
      targetLabel: "workspace",
      metadata: { kind: "workspace", includeFiles: true },
    });
    expect(await auditEntry(s.workspaceId, "export.downloaded")).toMatchObject({
      targetType: "export",
      targetId: id,
      metadata: { kind: "workspace" },
    });
  });

  it("tells the requester's user socket as it goes, and no one else's", async () => {
    const s = await exportScene();
    const socket = () =>
      ({
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1,
        raw: undefined,
        url: null,
        protocol: null,
      }) as never as { send: ReturnType<typeof vi.fn> };
    const mine = socket();
    const theirs = socket();
    const myConnection = addUserConnection(s.ada.id, mine as never);
    const theirConnection = addUserConnection(s.owner.id, theirs as never);
    try {
      const { id } = await startOk(s, s.ada);
      await drainExports();

      expect(
        mine.send.mock.calls.map(([raw]) => JSON.parse(raw as string)),
      ).toEqual(
        ["queued", "processing", "completed"].map((status) => ({
          type: "EXPORT_UPDATED",
          workspaceId: s.workspaceId,
          exportId: id,
          status,
        })),
      );
      expect(theirs.send).not.toHaveBeenCalled();
    } finally {
      removeUserConnection(s.ada.id, myConnection);
      removeUserConnection(s.owner.id, theirConnection);
    }
  });

  it("stays possible while the workspace waits to be deleted", async () => {
    const s = await exportScene();
    await db
      .update(schema.workspaceTable)
      .set({
        deletionScheduledAt: new Date(),
        deletionDueAt: new Date(Date.now() + DAY_MS),
      })
      .where(eq(schema.workspaceTable.id, s.workspaceId));
    expect((await start(s, s.ada)).status).toBe(200);
  });

  it("leaves task exports marked as such", async () => {
    const s = await exportScene();
    const created = await s.startExport(s.mia, { format: "csv" });
    expect(created).toMatchObject({ kind: "tasks", includeFiles: false });
  });
});

describe("the archive", () => {
  it("names files so they extract on any operating system", () => {
    expect(entrySegment("../Spec Sheet.PDF")).toBe("spec-sheet.pdf");
    expect(entrySegment("CON.txt")).toBe("file-con.txt");
    expect(entrySegment("aux")).toBe("file-aux");
    expect(entrySegment("console.txt")).toBe("console.txt");
    expect(entrySegment("notes.")).toBe("notes");
    expect(entrySegment("...")).toBe("file");
    expect(entrySegment(`${"x".repeat(300)}.pdf`)).toHaveLength(120);
  });

  it("holds pages and settings when there are no projects", async () => {
    const s = await exportScene();
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.workspaceId, s.workspaceId));
    await addPage(s, { projectId: null, title: "Workspace page" });

    const { row, json, entries } = await runAndRead(s, s.ada);

    expect(row).toMatchObject({ projectIds: [], taskCount: 0, fileCount: 0 });
    expect(
      json<{ counts: Record<string, number> }>("manifest.json").counts,
    ).toMatchObject({ projects: 0, tasks: 0, pages: 1 });
    expect(entries.has("workspace.json")).toBe(true);
    expect(
      json<{ pages: { title: string }[] }>("pages/pages.json").pages[0]?.title,
    ).toBe("Workspace page");
  });

  it("keeps which comment a reply answers", async () => {
    const s = await exportScene();
    const task = await s.createTask();
    const parent = await addComment(task.id, s.mia.id, "A question");
    const reply = await addComment(task.id, s.ada.id, "An answer", parent.id);

    const { json } = await runAndRead(s, s.ada);

    const { comments } = json<{
      tasks: { comments: { id: string; parentId: string | null }[] }[];
    }>("projects/web/tasks.json").tasks[0] ?? { comments: [] };
    expect(comments.find((comment) => comment.id === reply.id)).toMatchObject({
      parentId: parent.id,
    });
    expect(comments.find((comment) => comment.id === parent.id)).toMatchObject({
      parentId: null,
    });
  });

  it("holds tasks with every comment, pages, settings and files, as documented", async () => {
    const s = await exportScene();
    const task = await s.createTask({ title: "Ship it", createdBy: s.mia.id });
    await s.createTask({
      projectId: s.api.project.id,
      title: "Archived one",
      archivedAt: new Date(),
    });
    // More than the task export's cap of 200 per task.
    for (let n = 0; n < 205; n += 1) {
      await addComment(task.id, s.mia.id, `comment ${n}`);
    }
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, s.api.project.id));
    const page = await addPage(s, { publishedAt: new Date() });
    await db
      .insert(schema.pageCommentTable)
      .values({ pageId: page.id, userId: s.ada.id, content: "Nice page" });
    const attachment = await addAsset(
      s,
      { filename: "../Spec Sheet.PDF", taskId: task.id },
      "attachment bytes",
    );
    const pageImage = await addAsset(
      s,
      { filename: "diagram.png", pageId: page.id, surface: "page" },
      "image bytes",
    );

    const { row, json, entries } = await runAndRead(s, s.ada);

    expect(row).toMatchObject({
      kind: "workspace",
      taskCount: 2,
      fileCount: 2,
      missingFileCount: 0,
      contentType: "application/zip",
      storage: "local",
    });
    expect(row?.fileName).toMatch(/-workspace-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(entries.has("README.md")).toBe(true);
    expect(entries.get("README.md")?.toString()).toContain(
      "margaya.workspace-export.v1",
    );

    const manifest = json<{
      schema: string;
      counts: Record<string, number>;
      projects: { slug: string; folder: string }[];
      leftOut: { data: string[]; privatePages: number; hiddenProjects: number };
    }>("manifest.json");
    expect(manifest.schema).toBe("margaya.workspace-export.v1");
    expect(manifest.counts).toEqual({
      projects: 2,
      tasks: 2,
      pages: 1,
      files: 2,
      missingFiles: 0,
    });
    // Archived projects are part of a complete export.
    expect(manifest.projects.map((project) => project.slug).sort()).toEqual([
      "api",
      "web",
    ]);
    expect(manifest.leftOut.hiddenProjects).toBe(0);

    const tasks = json<{
      schema: string;
      tasks: { title: string; comments: { text: string }[] }[];
    }>("projects/web/tasks.json");
    expect(tasks.schema).toBe("margaya.task-export.v1");
    expect(tasks.tasks[0]?.title).toBe("Ship it");
    expect(tasks.tasks[0]?.comments).toHaveLength(205);
    expect(
      json<{ tasks: { title: string }[] }>("projects/api/tasks.json").tasks[0]
        ?.title,
    ).toBe("Archived one");

    const project = json<{
      project: { slug: string; cyclesEnabled: boolean };
      columns: unknown[];
    }>("projects/web/project.json");
    expect(project.project.slug).toBe("web");
    expect(project.project.cyclesEnabled).toBe(true);
    expect(Array.isArray(project.columns)).toBe(true);

    const pages = json<{
      pages: {
        id: string;
        markdown: string;
        comments: { text: string; author: { name: string } }[];
      }[];
    }>("pages/pages.json");
    expect(pages.pages).toHaveLength(1);
    expect(pages.pages[0]).toMatchObject({
      id: page.id,
      markdown: "# Welcome",
      comments: [{ text: "Nice page", author: { name: "Ada" } }],
    });

    const workspace = json<{
      workspace: { id: string; timezone: string };
      members: { name: string; email: string; role: string }[];
      roles: unknown[];
    }>("workspace.json");
    expect(workspace.workspace.id).toBe(s.workspaceId);
    expect(workspace.workspace.timezone).toBe("UTC");
    expect(workspace.members.map((member) => member.name)).toContain("Mia");

    const index = json<{
      files: {
        id: string;
        filename: string;
        taskId: string | null;
        pageId: string | null;
        path: string;
        missing: boolean;
        objectKey?: string;
      }[];
    }>("files/index.json");
    const listed = new Map(index.files.map((file) => [file.id, file]));
    const spec = listed.get(attachment.id);
    expect(spec).toMatchObject({
      filename: "../Spec Sheet.PDF",
      taskId: task.id,
      missing: false,
    });
    expect(spec?.objectKey).toBeUndefined();
    // The stored name can't climb out of its folder, and the bytes are intact.
    expect(spec?.path).toBe(
      `files/${attachment.id.toLowerCase()}/spec-sheet.pdf`,
    );
    expect(entries.get(spec?.path ?? "")?.toString()).toBe("attachment bytes");
    const image = listed.get(pageImage.id);
    expect(entries.get(image?.path ?? "")?.toString()).toBe("image bytes");
  });

  it("never holds secrets, private pages, or what is in the trash", async () => {
    const s = await exportScene();
    const live = await s.createTask({ title: "Live" });
    const trashed = await s.createTask({
      title: "TRASHED-TASK",
      deletedAt: new Date(),
    });
    await addComment(live.id, s.mia.id, "visible comment");
    await addPage(s, { publicToken: "PUBLIC-LINK-TOKEN", title: "Open" });
    const privatePage = await addPage(s, {
      access: "private",
      ownerId: s.ada.id,
      title: "PRIVATE-PAGE-OF-THE-REQUESTER",
      contentMarkdown: "PRIVATE-CONTENT",
    });
    const orphaned = await addPage(s, {
      access: "private",
      ownerId: null,
      title: "Ownerless private page",
    });
    await addPage(s, {
      title: "TRASHED-PAGE",
      archivedAt: new Date(),
      deletedAt: new Date(),
    });
    await addAsset(
      s,
      { filename: "private.bin", pageId: privatePage.id },
      "PRIVATE-FILE",
    );
    await addAsset(
      s,
      { filename: "trashed.bin", taskId: trashed.id },
      "TRASHED-FILE",
    );
    await addAsset(s, { filename: "dangling.bin" }, "DANGLING-FILE");
    await db.insert(schema.workspaceWebhookTable).values({
      workspaceId: s.workspaceId,
      url: "https://hooks.example.test/in",
      secretCiphertext: "WEBHOOK-SECRET",
      secretLast4: "LAST",
    });

    const { archive, json, entries } = await runAndRead(s, s.ada);

    // Stored files aren't compressed and documents are read back: search both.
    const everything = [...entries.values()]
      .map((data) => data.toString("utf8"))
      .join("\n");
    for (const forbidden of [
      "PUBLIC-LINK-TOKEN",
      "PRIVATE-PAGE-OF-THE-REQUESTER",
      "PRIVATE-CONTENT",
      "PRIVATE-FILE",
      "TRASHED-TASK",
      "TRASHED-PAGE",
      "TRASHED-FILE",
      "DANGLING-FILE",
      "WEBHOOK-SECRET",
      "hooks.example.test",
    ]) {
      expect(everything, forbidden).not.toContain(forbidden);
    }
    expect(archive.includes("PRIVATE-FILE")).toBe(false);
    expect(everything).toContain("visible comment");

    const pages = json<{ pages: { id: string; title: string }[] }>(
      "pages/pages.json",
    );
    expect(pages.pages.map((page) => page.title).sort()).toEqual([
      "Open",
      "Ownerless private page",
    ]);
    expect(pages.pages.some((page) => page.id === orphaned.id)).toBe(true);
    expect(
      json<{ leftOut: { privatePages: number } }>("manifest.json").leftOut
        .privatePages,
    ).toBe(1);
  });

  it("can leave the files out and still list them", async () => {
    const s = await exportScene();
    const task = await s.createTask();
    const asset = await addAsset(
      s,
      { filename: "kept-out.bin", taskId: task.id },
      "NOT-IN-THE-ARCHIVE",
    );

    const { row, json, entries } = await runAndRead(s, s.ada, false);

    expect(row).toMatchObject({ includeFiles: false, fileCount: 0 });
    expect(
      [...entries.keys()].some((name) => name.endsWith("kept-out.bin")),
    ).toBe(false);
    expect(json<{ files: unknown[] }>("files/index.json").files).toEqual([
      expect.objectContaining({ id: asset.id, path: null, missing: false }),
    ]);
  });

  it("reports files storage no longer has, without failing", async () => {
    const s = await exportScene();
    const task = await s.createTask();
    const gone = await addAsset(s, { filename: "gone.bin", taskId: task.id });
    await addAsset(s, { filename: "here.bin", taskId: task.id }, "here");

    const { row, json } = await runAndRead(s, s.ada);

    expect(row).toMatchObject({ fileCount: 1, missingFileCount: 1 });
    expect(
      json<{ files: { id: string; path: string | null; missing: boolean }[] }>(
        "files/index.json",
      ).files.find((file) => file.id === gone.id),
    ).toMatchObject({ path: null, missing: true });
    expect(
      json<{ counts: { missingFiles: number } }>("manifest.json").counts
        .missingFiles,
    ).toBe(1);
  });

  it("fails rather than finishing without files when storage misbehaves", async () => {
    const s = await exportScene();
    const task = await s.createTask();
    const asset = await addAsset(s, { filename: "odd.bin", taskId: task.id });
    // A folder where the object should be: an error other than "not found".
    await mkdir(resolveLocalPath(asset.objectKey), { recursive: true });

    const started = await startOk(s, s.ada);
    await drainExports();
    expect(await exportRow(started.id)).toMatchObject({
      status: "failed",
      error: EXPORT_FAILED,
    });
  });

  it("fails with a clear reason past the size limit, before doing the work", async () => {
    const s = await exportScene();
    const task = await s.createTask();
    await addAsset(s, { filename: "huge.bin", taskId: task.id, size: 5_000 });
    exportLimits.maxWorkspaceBytes = 1_000;

    const started = await startOk(s, s.ada);
    await drainExports();
    expect(await exportRow(started.id)).toMatchObject({
      status: "failed",
      error: WORKSPACE_EXPORT_TOO_LARGE,
    });
  });

  it("keeps the file in Postgres without any file storage, within its limit", async () => {
    vi.stubEnv("MARGAYA_LOCAL_STORAGE", "false");
    const s = await exportScene();
    const task = await s.createTask();
    await addAsset(s, { filename: "unreachable.bin", taskId: task.id });

    const { row } = await runAndRead(s, s.ada);
    expect(row).toMatchObject({
      storage: "database",
      fileCount: 0,
      missingFileCount: 1,
    });

    exportLimits.maxDatabaseBytes = 10;
    const started = await startOk(s, s.owner);
    await drainExports();
    expect(await exportRow(started.id)).toMatchObject({
      status: "failed",
      error: WORKSPACE_DATABASE_STORAGE_TOO_LARGE,
    });
  });
});

describe("who can reach it", () => {
  it("is hidden from members, and from a requester who lost the permission", async () => {
    const s = await exportScene();
    const { id } = await runAndRead(s, s.ada);

    for (const route of [`/task-export/${id}`, `/task-export/${id}/download`]) {
      expect((await s.as(s.mia)("GET", route)).status).toBe(404);
    }
    expect(
      (await s.as(s.owner)("GET", `/task-export/${id}/download`)).status,
    ).toBe(200);

    await setRole(s.ada.id, "member");
    for (const route of [`/task-export/${id}`, `/task-export/${id}/download`]) {
      expect((await s.as(s.ada)("GET", route)).status).toBe(404);
    }
    expect((await s.as(s.ada)("DELETE", `/task-export/${id}`)).status).toBe(
      404,
    );
    const listed = (await (
      await s.as(s.ada)("GET", `/task-export?workspaceId=${s.workspaceId}`)
    ).json()) as ExportPageJson;
    expect(listed.items.map((item) => item.id)).not.toContain(id);
  });

  it("doesn't run for a requester who lost the permission while it was queued", async () => {
    const s = await exportScene();
    const started = await startOk(s, s.ada);
    await setRole(s.ada.id, "member");

    await drainExports();
    expect(await exportRow(started.id)).toMatchObject({
      status: "failed",
      error: REQUESTER_GONE,
    });
  });

  it("takes reading all it holds: settings alone can't read through it", async () => {
    const s = await exportScene();
    await addPage(s, { title: "UNREADABLE-PAGE" });
    await addRole(s, "settings-only", {
      workspace: ["read", "manage_settings"],
      task: ["read"],
    });
    const { id } = await runAndRead(s, s.ada);
    await setRole(s.mia.id, "settings-only");

    expect((await start(s, s.mia)).status).toBe(403);
    expect(
      (await s.as(s.mia)("GET", `/task-export/${id}/download`)).status,
    ).toBe(404);
    const listed = (await (
      await s.as(s.mia)(
        "GET",
        `/task-export?workspaceId=${s.workspaceId}&scope=all`,
      )
    ).json()) as ExportPageJson;
    expect(listed.items.map((item) => item.id)).not.toContain(id);
  });

  it("doesn't run for a role that stopped being able to read what it holds", async () => {
    const s = await exportScene();
    await addRole(s, "exporter", WORKSPACE_EXPORT_PERMISSIONS);
    await setRole(s.mia.id, "exporter");
    const started = await startOk(s, s.mia);

    await db
      .update(schema.workspaceRoleTable)
      .set({
        permission: JSON.stringify({
          ...WORKSPACE_EXPORT_PERMISSIONS,
          page: [],
        }),
      })
      .where(eq(schema.workspaceRoleTable.role, "exporter"));

    await drainExports();
    expect(await exportRow(started.id)).toMatchObject({
      status: "failed",
      error: REQUESTER_GONE,
    });
  });

  it("leaves out projects a settings manager may not see", async () => {
    const s = await exportScene();
    const { project: secret } = await createProjectFixture({
      workspaceId: s.workspaceId,
      slug: "secret",
    });
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, secret.id));
    const secretTask = await s.createTask({
      projectId: secret.id,
      title: "RESTRICTED-TASK",
    });
    const waiting = await s.createTask({ title: "Waiting" });
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: secretTask.id,
      targetTaskId: waiting.id,
      relationType: "blocks",
    });
    await addPage(s, { projectId: secret.id, title: "RESTRICTED-PAGE" });
    await addRole(s, "settings-manager", WORKSPACE_EXPORT_PERMISSIONS);
    await setRole(s.mia.id, "settings-manager");

    const mine = await runAndRead(s, s.mia);
    const text = [...mine.entries.values()].map(String).join("\n");
    expect(text).not.toContain("RESTRICTED-TASK");
    expect(text).not.toContain("RESTRICTED-PAGE");
    expect(text).not.toContain("SECRET-1");
    expect(mine.entries.has("projects/secret/tasks.json")).toBe(false);
    expect(
      mine.json<{ leftOut: { hiddenProjects: number } }>("manifest.json")
        .leftOut.hiddenProjects,
    ).toBe(1);

    // The owner's archive holds the restricted project, so it stays out of reach.
    const owners = await runAndRead(s, s.owner);
    expect(owners.entries.has("projects/secret/tasks.json")).toBe(true);
    expect(String(owners.entries.get("projects/web/tasks.json"))).toContain(
      "SECRET-1",
    );
    expect(
      (await s.as(s.mia)("GET", `/task-export/${owners.id}/download`)).status,
    ).toBe(404);
  });
});

describe("a run after a crash", () => {
  it("builds again when the crashed run left its file behind", async () => {
    const s = await exportScene();
    const create = vi.spyOn(ZipFileWriter, "create");
    const { id } = await runAndRead(s, s.ada, false);
    const leftBehind = create.mock.calls[0]?.[0] as string;
    create.mockRestore();

    // What recoverExports does for a run that died mid-build: the row goes
    // back in the queue, and the partial file stays in the temp folder.
    await writeFile(leftBehind, "partial archive of the crashed run");
    await db
      .update(schema.taskExportTable)
      .set({ status: "queued", lockedUntil: null, completedAt: null })
      .where(eq(schema.taskExportTable.id, id));
    try {
      await drainExports();
      const row = await exportRow(id);
      expect(row?.error ?? null).toBeNull();
      expect(row?.status).toBe("completed");
    } finally {
      await rm(leftBehind, { force: true });
    }
  });

  it("has the archives crashed runs left behind swept once they're a day old", async () => {
    const left = (name: string) => path.join(tmpdir(), name);
    const stale = left(`margaya-workspace-export-${randomUUID()}-1.zip`);
    const recent = left(`margaya-workspace-export-${randomUUID()}-1.zip`);
    const unrelated = left(`unrelated-${randomUUID()}.zip`);
    const twoDaysAgo = new Date(Date.now() - 2 * DAY_MS);
    for (const file of [stale, recent, unrelated]) {
      await writeFile(file, "partial archive of a crashed run");
    }
    await utimes(stale, twoDaysAgo, twoDaysAgo);
    await utimes(unrelated, twoDaysAgo, twoDaysAgo);
    try {
      await runExportCleanup();
      await expect(stat(stale)).rejects.toMatchObject({ code: "ENOENT" });
      // One still being written, or written in the last day, may be a live run's.
      expect((await stat(recent)).isFile()).toBe(true);
      expect((await stat(unrelated)).isFile()).toBe(true);
    } finally {
      for (const file of [stale, recent, unrelated]) {
        await rm(file, { force: true });
      }
    }
  });
});

describe("retention", () => {
  it("expires by the retention setting and removes the file from the store", async () => {
    vi.stubEnv("EXPORT_RETENTION_DAYS", "2");
    const s = await exportScene();
    const { row, id } = await runAndRead(s, s.ada);
    if (!row?.objectKey || !row.completedAt || !row.expiresAt) {
      throw new Error("The export isn't stored");
    }
    expect(row.expiresAt.getTime() - row.completedAt.getTime()).toBe(
      2 * DAY_MS,
    );
    const stored = resolveLocalPath(row.objectKey);
    expect((await stat(stored)).isFile()).toBe(true);

    await runExportCleanup(new Date(row.expiresAt.getTime() + 1000));

    await expect(stat(stored)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await exportRow(id)).toMatchObject({
      status: "expired",
      objectKey: null,
    });
    expect(
      (await s.as(s.ada)("GET", `/task-export/${id}/download`)).status,
    ).toBe(410);
  });

  it("deleting the export removes its file", async () => {
    const s = await exportScene();
    const { row, id } = await runAndRead(s, s.ada);
    const stored = resolveLocalPath(row?.objectKey ?? "");

    expect((await s.as(s.ada)("DELETE", `/task-export/${id}`)).status).toBe(
      200,
    );
    await expect(stat(stored)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await exportRow(id)).toBeNull();
  });
});
