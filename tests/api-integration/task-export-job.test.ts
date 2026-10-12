import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { runExportCleanup } from "../../apps/api/src/task-export/cleanup";
import {
  claimNextExport,
  kickExportRunner,
  recoverExports,
  startExportRunner,
  stopExportRunner,
} from "../../apps/api/src/task-export/runner";
import { exportLimits } from "../../apps/api/src/task-export/settings";
import { removeFromWorkspace } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";
import {
  clearPublishedEvents,
  publishedEvents,
  recordEvents,
} from "./helpers/intake";
import { drainExports, exportRow, exportScene } from "./helpers/task-exports";

recordEvents("export.status_changed");
const defaults = { ...exportLimits };
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  stopExportRunner();
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  await resetTestDatabase();
  clearPublishedEvents();
});

afterEach(() => {
  Object.assign(exportLimits, defaults);
});

afterAll(() => {
  startExportRunner();
});

function statuses(exportId: string) {
  return publishedEvents("export.status_changed")
    .filter((event) => event.data.exportId === exportId)
    .map((event) => event.data.status);
}

async function setExport(
  id: string,
  values: Partial<typeof schema.taskExportTable.$inferInsert>,
) {
  await db
    .update(schema.taskExportTable)
    .set(values)
    .where(eq(schema.taskExportTable.id, id));
}

describe("export job", () => {
  it("runs in the background after the request queues it", async () => {
    const s = await exportScene();
    await s.createTask();
    startExportRunner();
    const created = await s.startExport(s.mia, { format: "csv" });
    await kickExportRunner();
    expect((await exportRow(created.id))?.status).toBe("completed");
  });

  it("stores the file in Postgres without object storage", async () => {
    const s = await exportScene();
    await s.createTask();
    const row = await s.runExport(s.mia, { format: "csv" });
    expect(row).toMatchObject({
      status: "completed",
      storage: "database",
      objectKey: null,
      attempts: 1,
      lockedUntil: null,
      error: null,
    });
    const [file] = await db
      .select()
      .from(schema.taskExportFileTable)
      .where(eq(schema.taskExportFileTable.exportId, row.id));
    expect(file?.content.length).toBe(row.sizeBytes);
    expect(statuses(row.id)).toEqual(["queued", "processing", "completed"]);
    expect(publishedEvents("export.status_changed")[0]?.data).toMatchObject({
      exportId: row.id,
      workspaceId: s.workspaceId,
      userId: s.mia.id,
    });
  });

  it("fails files over the database cap without object storage", async () => {
    const s = await exportScene();
    await s.createTask({ description: "x".repeat(500) });
    exportLimits.maxDatabaseBytes = 200;
    const row = await s.runExport(s.mia, { format: "json" });
    expect(row.status).toBe("failed");
    expect(row.error).toBe(
      "This export is larger than 25 MB, which needs object storage (S3). Ask your administrator, or choose fewer projects.",
    );
    expect(statuses(row.id)).toEqual(["queued", "processing", "failed"]);
    const files = await db.select().from(schema.taskExportFileTable);
    expect(files).toEqual([]);
  });

  it("fails exports over the uncompressed size cap", async () => {
    const s = await exportScene();
    await s.createTask({ description: "x".repeat(2_000) });
    exportLimits.maxUncompressedBytes = 1_000;
    const row = await s.runExport(s.mia, { format: "xlsx" });
    expect(row.status).toBe("failed");
    expect(row.error).toBe("This export is too large. Choose fewer projects.");
  });

  it("refuses more than 50,000 tasks", async () => {
    const s = await exportScene();
    await db.execute(sql`
      insert into task (id, project_id, title, number, status, priority)
      select 'bulk-' || g, ${s.web.project.id}, 'Bulk ' || g, g, 'to-do', 'low'
      from generate_series(1, 50001) as g
    `);
    const row = await s.runExport(s.mia, { format: "csv" });
    expect(row.status).toBe("failed");
    expect(row.error).toBe(
      "This export has 50,001 tasks. The limit is 50,000; choose fewer projects.",
    );
    expect(row.taskCount).toBeNull();
  });

  it("fails when the requester lost access or the projects are gone", async () => {
    const s = await exportScene();
    const lost = await s.startExport(s.mia, { format: "csv" });
    await removeFromWorkspace(s.mia.id, s.workspaceId);
    const gone = await s.startExport(s.ada, {
      format: "csv",
      projectIds: [s.api.project.id],
    });
    await db
      .delete(schema.projectTable)
      .where(eq(schema.projectTable.id, s.api.project.id));
    await drainExports();

    expect((await exportRow(lost.id))?.error).toBe(
      "The requester no longer has access to this workspace",
    );
    expect((await exportRow(gone.id))?.error).toBe(
      "The selected projects no longer exist",
    );
  });

  it("gives concurrent claims different exports", async () => {
    const s = await exportScene();
    const first = await s.startExport(s.mia, { format: "csv" });
    const second = await s.startExport(s.ada, { format: "csv" });
    const claims = await Promise.all([claimNextExport(), claimNextExport()]);
    expect(claims.map((row) => row?.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    for (const row of claims) {
      expect(row).toMatchObject({ status: "processing", attempts: 1 });
      expect(row?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    }
    expect(await claimNextExport()).toBeNull();
  });
});

describe("recoverExports", () => {
  it("requeues stale runs and fails the third interruption", async () => {
    const s = await exportScene();
    const stale = await s.startExport(s.mia, { format: "csv" });
    const exhausted = await s.startExport(s.ada, { format: "csv" });
    const live = await s.startExport(s.owner, { format: "csv" });
    const past = new Date(Date.now() - 60_000);
    await setExport(stale.id, {
      status: "processing",
      attempts: 1,
      lockedUntil: past,
    });
    await setExport(exhausted.id, {
      status: "processing",
      attempts: 3,
      lockedUntil: past,
    });
    await setExport(live.id, {
      status: "processing",
      attempts: 1,
      lockedUntil: new Date(Date.now() + 60_000),
    });

    expect(await recoverExports()).toEqual({
      degraded: false,
      requeued: 1,
      failed: 1,
    });
    expect(await exportRow(stale.id)).toMatchObject({
      status: "queued",
      lockedUntil: null,
      attempts: 1,
    });
    expect(await exportRow(exhausted.id)).toMatchObject({
      status: "failed",
      error: "The export was interrupted. Try again.",
    });
    expect((await exportRow(live.id))?.status).toBe("processing");
    expect(statuses(exhausted.id).at(-1)).toBe("failed");

    // The requeued export runs again as its second attempt.
    await drainExports();
    expect(await exportRow(stale.id)).toMatchObject({
      status: "completed",
      attempts: 2,
    });
  });
});

describe("runExportCleanup", () => {
  it("expires finished files and deletes old history", async () => {
    const s = await exportScene();
    await s.createTask();
    const due = await s.runExport(s.mia, { format: "csv" });
    const fresh = await s.runExport(s.mia, { format: "csv" });
    const old = await s.startExport(s.ada, { format: "csv" });
    const oldRunning = await s.startExport(s.owner, { format: "csv" });
    const recent = await s.startExport(s.vic, { format: "csv" });
    await setExport(due.id, { expiresAt: new Date(Date.now() - 1000) });
    await setExport(old.id, {
      status: "failed",
      createdAt: new Date(Date.now() - 91 * DAY),
    });
    await setExport(oldRunning.id, {
      status: "processing",
      createdAt: new Date(Date.now() - 91 * DAY),
    });
    await setExport(recent.id, {
      createdAt: new Date(Date.now() - 89 * DAY),
    });

    expect(await runExportCleanup()).toEqual({
      degraded: false,
      expired: 1,
      deleted: 1,
    });

    expect(await exportRow(due.id)).toMatchObject({
      status: "expired",
      objectKey: null,
      fileName: due.fileName,
      sizeBytes: due.sizeBytes,
    });
    const files = await db
      .select({ exportId: schema.taskExportFileTable.exportId })
      .from(schema.taskExportFileTable);
    expect(files.map((file) => file.exportId)).toEqual([fresh.id]);
    expect((await exportRow(fresh.id))?.status).toBe("completed");
    expect(await exportRow(old.id)).toBeNull();
    expect(await exportRow(oldRunning.id)).not.toBeNull();
    expect(await exportRow(recent.id)).not.toBeNull();
    expect(statuses(due.id).at(-1)).toBe("expired");

    const expired = await s.as(s.mia)("GET", `/task-export/${due.id}/download`);
    expect(expired.status).toBe(410);
  });
});
