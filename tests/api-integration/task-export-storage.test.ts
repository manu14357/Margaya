import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { runExportCleanup } from "../../apps/api/src/task-export/cleanup";
import {
  startExportRunner,
  stopExportRunner,
} from "../../apps/api/src/task-export/runner";
import { purgeWorkspaceExports } from "../../apps/api/src/task-export/storage";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { drainExports, exportRow, exportScene } from "./helpers/task-exports";

// Object storage stands in as an in-memory bucket; everything else (routes,
// job, Postgres) is real.
const bucket = vi.hoisted(() => ({
  objects: new Map<string, { body: Buffer; contentType: string }>(),
  deleted: [] as string[],
  failDeletes: false,
}));

vi.mock("../../apps/api/src/storage/s3", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/api/src/storage/s3")>();
  return {
    ...actual,
    putPrivateObject: async (
      key: string,
      body: Uint8Array,
      contentType: string,
    ) => {
      bucket.objects.set(key, { body: Buffer.from(body), contentType });
    },
    getPrivateObject: async (key: string) => {
      const object = bucket.objects.get(key);
      if (!object) throw new Error("NoSuchKey");
      return {
        body: new Uint8Array(object.body),
        contentType: object.contentType,
        contentLength: object.body.length,
        etag: undefined,
        lastModified: undefined,
      };
    },
    deleteS3Object: async (key: string) => {
      if (bucket.failDeletes) throw new Error("storage down");
      bucket.deleted.push(key);
      bucket.objects.delete(key);
    },
  };
});

beforeEach(async () => {
  stopExportRunner();
  process.env.S3_ENDPOINT = "http://storage.test";
  process.env.S3_BUCKET = "margaya";
  process.env.S3_KEY_PREFIX = "tenant-a";
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
  bucket.objects.clear();
  bucket.deleted.length = 0;
  bucket.failDeletes = false;
  await resetTestDatabase();
});

afterAll(() => {
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  delete process.env.S3_KEY_PREFIX;
  startExportRunner();
});

describe("exports in object storage", () => {
  it("stores, streams and deletes the file under the exports prefix", async () => {
    const s = await exportScene();
    await s.createTask({ title: "Stored" });
    const row = await s.runExport(s.mia, { format: "json" });
    const key = `tenant-a/exports/${s.workspaceId}/${row.id}/${row.fileName}`;
    expect(row).toMatchObject({ status: "completed", storage: "s3" });
    expect(row.objectKey).toBe(key);
    expect(bucket.objects.get(key)?.contentType).toBe("application/json");
    expect(await db.select().from(schema.taskExportFileTable)).toEqual([]);

    const body = await s.download(s.mia, row.id);
    expect(JSON.parse(body.toString("utf8")).tasks[0].title).toBe("Stored");

    await s.ok(s.mia, "DELETE", `/task-export/${row.id}`);
    expect(bucket.deleted).toEqual([key]);
  });

  it("deletes expired objects, and retries when storage refuses", async () => {
    const s = await exportScene();
    const row = await s.runExport(s.mia, { format: "csv" });
    await db
      .update(schema.taskExportTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.taskExportTable.id, row.id));

    bucket.failDeletes = true;
    expect(await runExportCleanup()).toEqual({
      degraded: true,
      expired: 0,
      deleted: 0,
    });
    expect((await exportRow(row.id))?.status).toBe("completed");

    bucket.failDeletes = false;
    expect((await runExportCleanup()).expired).toBe(1);
    expect(await exportRow(row.id)).toMatchObject({
      status: "expired",
      objectKey: null,
    });
    expect(bucket.deleted).toEqual([row.objectKey]);
  });

  it("purges a workspace's objects before the workspace is deleted", async () => {
    const s = await exportScene();
    const mine = await s.runExport(s.mia, { format: "csv" });
    const other = await createWorkspaceMember({ role: "owner" });
    await createProjectFixture({ workspaceId: other.workspace.id });
    const theirs = await s.ok<{ id: string }>(
      other.user,
      "POST",
      "/task-export",
      {
        workspaceId: other.workspace.id,
        format: "csv",
      },
    );
    await drainExports();
    const theirsRow = await exportRow(theirs.id);

    await purgeWorkspaceExports(s.workspaceId);
    expect(bucket.deleted).toEqual([mine.objectKey]);
    expect(bucket.objects.has(theirsRow?.objectKey ?? "")).toBe(true);
  });
});
