import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { projectMemberTable } from "../../apps/api/src/database/schema";
import {
  runNextExport,
  startExportRunner,
  stopExportRunner,
} from "../../apps/api/src/task-export/runner";
import {
  addUserConnection,
  removeUserConnection,
} from "../../apps/api/src/ws/index";
import { mockAnonymousSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture } from "./helpers/fixtures";
import {
  drainExports,
  type ExportJson,
  type ExportPageJson,
  exportRow,
  exportScene,
} from "./helpers/task-exports";

beforeEach(async () => {
  // Requests only queue; each test runs the job explicitly.
  stopExportRunner();
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  await resetTestDatabase();
});

afterAll(() => {
  startExportRunner();
});

async function setProject(
  projectId: string,
  values: Partial<typeof schema.projectTable.$inferInsert>,
) {
  await db
    .update(schema.projectTable)
    .set(values)
    .where(eq(schema.projectTable.id, projectId));
}

describe("POST /task-export", () => {
  it("queues an export of the non-archived projects in project order", async () => {
    const s = await exportScene();
    const { project: ops } = await createProjectFixture({
      workspaceId: s.workspaceId,
      name: "Ops",
      slug: "ops",
    });
    await setProject(s.web.project.id, { position: 2 });
    await setProject(s.api.project.id, { position: 1 });
    await setProject(ops.id, { archivedAt: new Date() });

    const created = await s.startExport(s.mia, { format: "csv" });
    expect(created).toMatchObject({
      workspaceId: s.workspaceId,
      format: "csv",
      projectIds: [s.api.project.id, s.web.project.id],
      splitByProject: false,
      includeArchived: true,
      status: "queued",
      error: null,
      taskCount: null,
      fileName: null,
      requestedBy: { id: s.mia.id, name: "Mia" },
      startedAt: null,
      expiresAt: null,
      downloadable: false,
    });
    expect(created.projects.map((project) => project.slug)).toEqual([
      "api",
      "web",
    ]);
  });

  it("takes explicit projects, archived ones included, deduplicated", async () => {
    const s = await exportScene();
    await setProject(s.api.project.id, { archivedAt: new Date() });
    const created = await s.startExport(s.vic, {
      format: "xlsx",
      projectIds: [s.api.project.id, s.web.project.id, s.api.project.id],
      splitByProject: true,
      includeArchived: false,
    });
    expect(created.projectIds).toEqual([s.web.project.id, s.api.project.id]);
    expect(created.splitByProject).toBe(true);
    expect(created.includeArchived).toBe(false);
  });

  it("stores splitByProject as false for a single project", async () => {
    const s = await exportScene();
    const created = await s.startExport(s.mia, {
      format: "json",
      projectIds: [s.web.project.id],
      splitByProject: true,
    });
    expect(created.splitByProject).toBe(false);
  });

  it("rejects foreign projects, empty workspaces and bad bodies", async () => {
    const s = await exportScene();
    const { project: foreign } = await createProjectFixture({
      workspaceId: s.outsiderWorkspaceId,
    });
    const post = (body: Record<string, unknown>) =>
      s.as(s.mia)("POST", "/task-export", {
        workspaceId: s.workspaceId,
        ...body,
      });

    const notFound = await post({
      format: "csv",
      projectIds: [s.web.project.id, foreign.id],
    });
    expect(notFound.status).toBe(404);
    expect(await notFound.text()).toBe("Project not found");

    expect((await post({ format: "pdf" })).status).toBe(400);
    expect(
      (
        await post({
          format: "csv",
          projectIds: Array.from({ length: 101 }, (_, i) => `p${i}`),
        })
      ).status,
    ).toBe(400);

    await setProject(s.web.project.id, { archivedAt: new Date() });
    await setProject(s.api.project.id, { archivedAt: new Date() });
    const empty = await post({ format: "csv" });
    expect(empty.status).toBe(400);
    expect(await empty.text()).toBe("There are no projects to export");
  });

  it("allows three exports in progress per person and workspace", async () => {
    const s = await exportScene();
    for (let i = 0; i < 3; i += 1) {
      await s.startExport(s.mia, { format: "csv" });
    }
    const fourth = await s.as(s.mia)("POST", "/task-export", {
      workspaceId: s.workspaceId,
      format: "csv",
    });
    expect(fourth.status).toBe(409);
    expect(await fourth.text()).toBe(
      "You already have 3 exports in progress. Wait for one to finish.",
    );
    // Someone else is not affected, and a finished export frees a slot.
    await s.startExport(s.ada, { format: "csv" });
    await drainExports();
    await s.startExport(s.mia, { format: "csv" });
  });

  it("needs workspace access and task:read", async () => {
    const s = await exportScene();
    const outsider = await s.as(s.outsider)("POST", "/task-export", {
      workspaceId: s.workspaceId,
      format: "csv",
    });
    expect(outsider.status).toBe(403);

    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: s.workspaceId,
      role: "blind",
      permission: JSON.stringify({ project: ["read"] }),
    });
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "blind" })
      .where(eq(schema.workspaceUserTable.userId, s.vic.id));
    const blind = await s.as(s.vic)("POST", "/task-export", {
      workspaceId: s.workspaceId,
      format: "csv",
    });
    expect(blind.status).toBe(403);
    expect(await blind.text()).toBe("Insufficient permissions");
  });

  it("honors API key scopes", async () => {
    const s = await exportScene();
    const keyFor = async (permissions: Record<string, string[]>) => {
      const key = `margaya_test_${randomUUID()}`;
      await db.insert(schema.apikeyTable).values({
        referenceId: s.ada.id,
        userId: s.ada.id,
        key: createHash("sha256").update(key).digest("base64url"),
        name: "exports",
        createdAt: new Date(),
        updatedAt: new Date(),
        permissions: JSON.stringify(permissions),
        enabled: true,
      });
      return key;
    };
    const post = async (key: string) => {
      mockAnonymousSession();
      return s.app.request("/api/task-export", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ workspaceId: s.workspaceId, format: "csv" }),
      });
    };

    const denied = await post(await keyFor({ project: ["read"] }));
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe("Insufficient API key scope");

    const reader = await keyFor({ task: ["read"] });
    const created = await post(reader);
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as ExportJson;
    await drainExports();

    mockAnonymousSession();
    const file = await s.app.request(`/api/task-export/${id}/download`, {
      headers: { Authorization: `Bearer ${reader}` },
    });
    expect(file.status).toBe(200);

    // The admin's key without manage_settings can't see everyone's list.
    mockAnonymousSession();
    const all = await s.app.request(
      `/api/task-export?workspaceId=${s.workspaceId}&scope=all`,
      { headers: { Authorization: `Bearer ${reader}` } },
    );
    expect(all.status).toBe(403);
    expect(await all.text()).toBe("Only workspace admins can see all exports");
  });
});

describe("GET /task-export", () => {
  it("lists the caller's own exports, or everyone's for admins", async () => {
    const s = await exportScene();
    const mine = await s.startExport(s.mia, { format: "csv" });
    const adas = await s.startExport(s.ada, { format: "json" });

    const list = (user: typeof s.mia, query: string) =>
      s.ok<ExportPageJson>(
        user,
        "GET",
        `/task-export?workspaceId=${s.workspaceId}${query}`,
      );

    expect((await list(s.mia, "")).items.map((item) => item.id)).toEqual([
      mine.id,
    ]);
    const all = await list(s.ada, "&scope=all");
    expect(all.items.map((item) => item.id)).toEqual([adas.id, mine.id]);
    expect(all.nextCursor).toBeNull();

    const denied = await s.as(s.mia)(
      "GET",
      `/task-export?workspaceId=${s.workspaceId}&scope=all`,
    );
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe(
      "Only workspace admins can see all exports",
    );
  });

  it("pages with a keyset cursor", async () => {
    const s = await exportScene();
    const ids: string[] = [];
    for (const user of [s.mia, s.ada, s.owner, s.vic, s.mia]) {
      ids.push((await s.startExport(user, { format: "csv" })).id);
    }
    const newestFirst = [...ids].reverse();
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `&cursor=${cursor}` : "";
      const page: ExportPageJson = await s.ok<ExportPageJson>(
        s.owner,
        "GET",
        `/task-export?workspaceId=${s.workspaceId}&scope=all&limit=2${query}`,
      );
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(newestFirst);

    const bad = await s.as(s.owner)(
      "GET",
      `/task-export?workspaceId=${s.workspaceId}&cursor=nope`,
    );
    expect(bad.status).toBe(400);
    expect(await bad.text()).toBe("Invalid cursor");
  });
});

describe("an export of a project its requester lost", () => {
  async function exportedThenRemoved() {
    const s = await exportScene();
    await s.createTask({ title: "Secret plan" });
    await setProject(s.web.project.id, { visibility: "restricted" });
    await db.insert(projectMemberTable).values({
      projectId: s.web.project.id,
      userId: s.mia.id,
      role: "member",
    });
    const created = await s.startExport(s.mia, {
      format: "csv",
      projectIds: [s.web.project.id],
    });
    await drainExports();
    await s.download(s.mia, created.id);

    await db
      .delete(projectMemberTable)
      .where(eq(projectMemberTable.userId, s.mia.id));
    return { s, created };
  }

  it("reads as missing, and the file can't be downloaded", async () => {
    const { s, created } = await exportedThenRemoved();

    for (const path of [
      `/task-export/${created.id}`,
      `/task-export/${created.id}/download`,
    ]) {
      const response = await s.as(s.mia)("GET", path);
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toContain("Secret plan");
    }
  });

  it("drops out of their list, and comes back with their access", async () => {
    const { s, created } = await exportedThenRemoved();
    const list = () =>
      s.ok<ExportPageJson>(
        s.mia,
        "GET",
        `/task-export?workspaceId=${s.workspaceId}`,
      );
    expect((await list()).items).toEqual([]);

    await db.insert(projectMemberTable).values({
      projectId: s.web.project.id,
      userId: s.mia.id,
      role: "member",
    });
    expect((await list()).items.map((item) => item.id)).toEqual([created.id]);
    await s.download(s.mia, created.id);
  });

  it("stays with an admin, who still sees the project", async () => {
    const { s, created } = await exportedThenRemoved();
    await s.download(s.ada, created.id);
  });
});

describe("one export", () => {
  it("is visible to its requester and admins only", async () => {
    const s = await exportScene();
    await s.createTask({ title: "Hello" });
    const created = await s.startExport(s.mia, { format: "csv" });
    await drainExports();

    for (const user of [s.mia, s.ada, s.owner]) {
      const got = await s.ok<ExportJson>(
        user,
        "GET",
        `/task-export/${created.id}`,
      );
      expect(got.status).toBe("completed");
      await s.download(user, created.id);
    }
    for (const user of [s.vic, s.outsider]) {
      for (const path of ["", "/download"]) {
        const response = await s.as(user)(
          "GET",
          `/task-export/${created.id}${path}`,
        );
        expect(response.status).toBe(404);
        expect(await response.text()).toBe("Export not found");
      }
      const removed = await s.as(user)("DELETE", `/task-export/${created.id}`);
      expect(removed.status).toBe(404);
    }
    const missing = await s.as(s.mia)("GET", "/task-export/nope");
    expect(missing.status).toBe(404);
  });

  it("downloads with attachment headers once ready, 409 before, 410 after", async () => {
    const s = await exportScene();
    await s.createTask({ title: "Hello" });
    const created = await s.startExport(s.mia, {
      format: "csv",
      projectIds: [s.web.project.id],
    });

    const early = await s.as(s.mia)(
      "GET",
      `/task-export/${created.id}/download`,
    );
    expect(early.status).toBe(409);
    expect(await early.text()).toBe("This export isn't ready yet");

    await drainExports();
    const ready = await s.ok<ExportJson>(
      s.mia,
      "GET",
      `/task-export/${created.id}`,
    );
    const date = new Date().toISOString().slice(0, 10);
    expect(ready).toMatchObject({
      status: "completed",
      taskCount: 1,
      fileName: `web-tasks-${date}.csv`,
      contentType: "text/csv; charset=utf-8",
      downloadable: true,
    });
    const days =
      (Date.parse(ready.expiresAt ?? "") -
        Date.parse(ready.completedAt ?? "")) /
      86_400_000;
    expect(days).toBeCloseTo(7, 5);

    const response = await s.as(s.mia)(
      "GET",
      `/task-export/${created.id}/download`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="web-tasks-${date}.csv"; filename*=UTF-8''web-tasks-${date}.csv`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = Buffer.from(await response.arrayBuffer());
    expect(response.headers.get("content-length")).toBe(String(body.length));
    expect(body.length).toBe(ready.sizeBytes);

    await db
      .update(schema.taskExportTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.taskExportTable.id, created.id));
    const late = await s.as(s.mia)(
      "GET",
      `/task-export/${created.id}/download`,
    );
    expect(late.status).toBe(410);
    expect(await late.text()).toBe("This export has expired");
  });

  it("deletes queued and finished exports, but not running ones", async () => {
    const s = await exportScene();
    const queued = await s.startExport(s.mia, { format: "csv" });
    const done = await s.startExport(s.mia, { format: "csv" });
    const running = await s.startExport(s.mia, { format: "csv" });
    await db
      .update(schema.taskExportTable)
      .set({ createdAt: new Date(Date.now() + 60_000) })
      .where(eq(schema.taskExportTable.id, queued.id));
    // Runs `done` (oldest), then marks `running` as claimed elsewhere.
    await db
      .update(schema.taskExportTable)
      .set({ createdAt: new Date(Date.now() + 120_000) })
      .where(eq(schema.taskExportTable.id, running.id));
    expect(await runNextExport()).toBe(done.id);
    await db
      .update(schema.taskExportTable)
      .set({ status: "processing", lockedUntil: new Date(Date.now() + 60_000) })
      .where(eq(schema.taskExportTable.id, running.id));

    const busy = await s.as(s.mia)("DELETE", `/task-export/${running.id}`);
    expect(busy.status).toBe(409);
    expect(await busy.text()).toBe("This export is still running");

    expect(await s.ok(s.mia, "DELETE", `/task-export/${queued.id}`)).toEqual({
      id: queued.id,
    });
    expect(await exportRow(queued.id)).toBeNull();

    // An admin may delete someone else's export; its stored file goes too.
    expect(await s.ok(s.ada, "DELETE", `/task-export/${done.id}`)).toEqual({
      id: done.id,
    });
    const files = await db
      .select()
      .from(schema.taskExportFileTable)
      .where(eq(schema.taskExportFileTable.exportId, done.id));
    expect(files).toEqual([]);
  });

  it("tells the requester's user socket about each status change", async () => {
    const s = await exportScene();
    const send = vi.fn();
    const ws = {
      send,
      close: vi.fn(),
      readyState: 1,
      raw: undefined,
      url: null,
      protocol: null,
    } as never;
    const connection = addUserConnection(s.mia.id, ws);
    try {
      const created = await s.startExport(s.mia, { format: "json" });
      await drainExports();
      await s.ok(s.mia, "DELETE", `/task-export/${created.id}`);
      const messages = send.mock.calls.map(([raw]) =>
        JSON.parse(raw as string),
      );
      expect(messages).toEqual(
        ["queued", "processing", "completed", "deleted"].map((status) => ({
          type: "EXPORT_UPDATED",
          workspaceId: s.workspaceId,
          exportId: created.id,
          status,
        })),
      );
    } finally {
      removeUserConnection(s.mia.id, connection);
    }
  });
});
