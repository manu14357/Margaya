import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db from "../../apps/api/src/database";
import { storageUploadTable } from "../../apps/api/src/database/schema";
import { resolveLocalPath } from "../../apps/api/src/storage/local";
import { sweepAbandonedUploads } from "../../apps/api/src/storage/upload-sweep";
import { mockAnonymousSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { json, taskDetailScene } from "./helpers/task-detail";

// The built-in file store: used when S3 is not configured. Uploads go to a
// signed API link instead of a presigned S3 URL, downloads through the same
// authorized asset route.

let storageDir: string;

beforeEach(async () => {
  await resetTestDatabase();
  storageDir = await mkdtemp(path.join(tmpdir(), "margaya-storage-"));
  vi.stubEnv("MARGAYA_LOCAL_STORAGE", "true");
  vi.stubEnv("MARGAYA_STORAGE_DIR", storageDir);
  vi.stubEnv("S3_ENDPOINT", "");
  vi.stubEnv("S3_BUCKET", "");
  vi.stubEnv("S3_MAX_IMAGE_UPLOAD_BYTES", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(storageDir, { recursive: true, force: true });
});

const pdf = { filename: "spec.pdf", contentType: "application/pdf", size: 5 };
const bytes = new Uint8Array([37, 80, 68, 70, 45]);

async function scene() {
  const s = await taskDetailScene();
  const task = await s.createTask();
  const asMember = s.as(s.member);

  const createUpload = async (file = pdf) => {
    const response = await asMember(
      `/task-attachment/${task.id}/upload`,
      json("POST", file),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as {
      key: string;
      uploadUrl: string;
      headers: Record<string, string>;
    };
  };

  /** The browser's PUT: no session, only the signed link. */
  const put = (
    uploadUrl: string,
    body: Uint8Array,
    contentType = pdf.contentType,
  ) => {
    mockAnonymousSession();
    const url = new URL(uploadUrl);
    return s.app.request(url.pathname, {
      method: "PUT",
      headers: { "content-type": contentType },
      body,
    });
  };

  const finalize = (key: string, file = pdf) =>
    asMember(
      `/task-attachment/${task.id}/finalize`,
      json("POST", { key, ...file }),
    );

  return { ...s, task, asMember, createUpload, put, finalize };
}

describe("local file store", () => {
  it("uploads through a signed link, finalizes and serves the file to members", async () => {
    const s = await scene();
    const upload = await s.createUpload();
    expect(upload.uploadUrl).toMatch(
      /^http:\/\/localhost:1337\/api\/storage\/upload\/[\w-]+\.[\w-]+$/,
    );
    expect(upload.headers).toEqual({ "Content-Type": "application/pdf" });

    const stored = await s.put(upload.uploadUrl, bytes);
    expect(stored.status).toBe(200);
    expect(existsSync(path.join(storageDir, ...upload.key.split("/")))).toBe(
      true,
    );

    const finalized = await s.finalize(upload.key);
    expect(finalized.status).toBe(200);
    const attachment = (await finalized.json()) as { id: string };

    const download = await s.asMember(`/asset/${attachment.id}`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  });

  it("answers 404 for another workspace's file and 401 without a session", async () => {
    const s = await scene();
    const upload = await s.createUpload();
    await s.put(upload.uploadUrl, bytes);
    const attachment = (await (await s.finalize(upload.key)).json()) as {
      id: string;
    };

    const outsider = await s.as(s.outsider)(`/asset/${attachment.id}`);
    expect(outsider.status).toBe(404);
    expect(await outsider.text()).toBe("Asset not found");

    mockAnonymousSession();
    expect((await s.app.request(`/api/asset/${attachment.id}`)).status).toBe(
      401,
    );
  });

  it("refuses tampered links, other content types, wrong sizes and a second upload", async () => {
    const s = await scene();
    const upload = await s.createUpload();
    const token = upload.uploadUrl.split("/").pop();
    if (!token) throw new Error("The upload URL has no token");
    const [payload, signature] = token.split(".");

    // Re-pointing the payload at another workspace's folder breaks the signature.
    const forged = Buffer.from(
      JSON.stringify({
        k: "workspace/other/project/p/task/t/attachments/x.pdf",
        t: "application/pdf",
        s: 5,
        e: Date.now() + 60_000,
      }),
    ).toString("base64url");
    const base = upload.uploadUrl.slice(0, upload.uploadUrl.lastIndexOf("/"));
    expect((await s.put(`${base}/${forged}.${signature}`, bytes)).status).toBe(
      403,
    );
    expect((await s.put(`${base}/${payload}.AAAA`, bytes)).status).toBe(403);

    expect((await s.put(upload.uploadUrl, bytes, "text/html")).status).toBe(
      400,
    );
    expect((await s.put(upload.uploadUrl, new Uint8Array(6))).status).toBe(413);
    expect((await s.put(upload.uploadUrl, new Uint8Array(4))).status).toBe(400);

    expect((await s.put(upload.uploadUrl, bytes)).status).toBe(200);
    expect((await s.put(upload.uploadUrl, bytes)).status).toBe(409);
  });

  it("refuses an expired link", async () => {
    vi.stubEnv("S3_PRESIGN_TTL_SECONDS", "1");
    const s = await scene();
    const upload = await s.createUpload();
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 5_000);
    try {
      expect((await s.put(upload.uploadUrl, bytes)).status).toBe(403);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("finalize refuses a key that was never uploaded", async () => {
    const s = await scene();
    const upload = await s.createUpload();
    const response = await s.finalize(upload.key);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Uploaded object was not found.");
  });

  it("answers 404 on the upload route when S3 is configured", async () => {
    const s = await scene();
    const upload = await s.createUpload();
    vi.stubEnv("S3_ENDPOINT", "https://storage.example.test");
    vi.stubEnv("S3_BUCKET", "bucket");
    expect((await s.put(upload.uploadUrl, bytes)).status).toBe(404);
  });

  it("never resolves a key outside the storage folder", () => {
    for (const key of [
      "../etc/passwd",
      "workspace/../../secret",
      "workspace/./x",
      "/etc/passwd",
      "workspace//x",
      "C:\\Windows\\win.ini",
      "workspace/..%2f..%2fx",
      ".meta/workspace/x.json",
      ".tmp/x.part",
      "",
    ]) {
      expect(() => resolveLocalPath(key, storageDir), key).toThrow(
        "Invalid storage key",
      );
    }
    expect(resolveLocalPath("workspace/a/file.pdf", storageDir)).toBe(
      path.join(storageDir, "workspace", "a", "file.pdf"),
    );
  });
});

describe("abandoned upload sweep", () => {
  it("deletes day-old uploads that were never finalized and keeps finalized ones", async () => {
    const s = await scene();
    const abandoned = await s.createUpload();
    await s.put(abandoned.uploadUrl, bytes);
    const kept = await s.createUpload();
    await s.put(kept.uploadUrl, bytes);
    expect((await s.finalize(kept.key)).status).toBe(200);
    const fresh = await s.createUpload();
    await s.put(fresh.uploadUrl, bytes);

    const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    for (const key of [abandoned.key, kept.key]) {
      await db
        .update(storageUploadTable)
        .set({ createdAt: dayAgo })
        .where(eq(storageUploadTable.objectKey, key));
    }
    // A temporary file a cut-off upload left behind.
    await mkdir(path.join(storageDir, ".tmp"), { recursive: true });
    const partial = path.join(storageDir, ".tmp", "old.part");
    await writeFile(partial, "partial");
    await utimes(partial, dayAgo, dayAgo);

    const outcome = await sweepAbandonedUploads();
    expect(outcome).toEqual({ removed: 2, finalized: 1, degraded: false });

    const file = (key: string) => path.join(storageDir, ...key.split("/"));
    expect(existsSync(file(abandoned.key))).toBe(false);
    expect((await stat(file(kept.key))).size).toBe(5);
    expect(existsSync(file(fresh.key))).toBe(true);
    expect(existsSync(partial)).toBe(false);
    const rows = await db
      .select({ key: storageUploadTable.objectKey })
      .from(storageUploadTable);
    expect(rows.map((row) => row.key)).toEqual([fresh.key]);
  });
});
