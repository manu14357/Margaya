import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resolveLocalPath } from "../../apps/api/src/storage/local";
import { mockAnonymousSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  allowPublicPages,
  createElement,
  json,
  type WhiteboardScene,
  whiteboardScene,
} from "./helpers/whiteboards";

// Images on a board, through the built-in file store: the upload key comes
// from the board and the image id, and finalizing checks the bytes.

let storageDir: string;
let s: WhiteboardScene;

beforeEach(async () => {
  await resetTestDatabase();
  storageDir = await mkdtemp(path.join(tmpdir(), "margaya-wb-storage-"));
  vi.stubEnv("MARGAYA_LOCAL_STORAGE", "true");
  vi.stubEnv("MARGAYA_STORAGE_DIR", storageDir);
  vi.stubEnv("S3_ENDPOINT", "");
  vi.stubEnv("S3_BUCKET", "");
  vi.stubEnv("S3_MAX_IMAGE_UPLOAD_BYTES", "");
  s = await whiteboardScene();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(storageDir, { recursive: true, force: true });
});

function be32(n: number) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

const PNG = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...be32(13),
  ..."IHDR".split("").map((char) => char.charCodeAt(0)),
  ...be32(64),
  ...be32(32),
  8,
  6,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");

async function upload(
  boardId: string,
  bytes: Uint8Array,
  contentType = "image/png",
) {
  const created = await s.ok<{
    assetId: string;
    upload: { uploadUrl: string; headers: Record<string, string> };
  }>(
    s.ben,
    `/whiteboard/${boardId}/assets`,
    json("POST", { filename: "pic.png", contentType, size: bytes.byteLength }),
  );
  // The browser's PUT: no session, only the signed link.
  mockAnonymousSession();
  const put = await s.app.request(new URL(created.upload.uploadUrl).pathname, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: bytes,
  });
  expect(put.status, await put.clone().text()).toBe(200);
  const finalize = await s.call(
    s.ben,
    `/whiteboard/${boardId}/assets/${created.assetId}/finalize`,
    json("POST", { contentType, size: bytes.byteLength }),
  );
  return { assetId: created.assetId, finalize };
}

describe("whiteboard images", () => {
  it("stores a real PNG with its size and serves it to readers", async () => {
    const board = await s.create(s.ben);
    const { assetId, finalize } = await upload(board.id, PNG);
    expect(finalize.status, await finalize.clone().text()).toBe(200);
    const asset = await finalize.json();
    expect(asset).toEqual({
      id: assetId,
      whiteboardId: board.id,
      mimeType: "image/png",
      size: PNG.byteLength,
      width: 64,
      height: 32,
      createdAt: expect.any(String),
    });
    expect(asset).not.toHaveProperty("objectKey");

    const read = await s.call(
      s.viewer,
      `/whiteboard/${board.id}/assets/${assetId}`,
    );
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toBe("image/png");
    expect(read.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(PNG);

    // Another board's route never serves it.
    const other = await s.create(s.ben);
    expect(
      (await s.call(s.viewer, `/whiteboard/${other.id}/assets/${assetId}`))
        .status,
    ).toBe(404);
    // Finalizing again returns the same image.
    const again = await s.call(
      s.ben,
      `/whiteboard/${board.id}/assets/${assetId}/finalize`,
      json("POST", { contentType: "image/png", size: PNG.byteLength }),
    );
    expect(again.status).toBe(200);
  });

  it("refuses bytes that are not the image they claim to be, and deletes them", async () => {
    const board = await s.create(s.ben);
    const { assetId, finalize } = await upload(board.id, HTML);
    expect(finalize.status).toBe(400);
    expect(await finalize.text()).toMatch(/not a PNG, JPEG, GIF or WebP/);
    const rows = await db
      .select()
      .from(schema.whiteboardAssetTable)
      .where(eq(schema.whiteboardAssetTable.id, assetId));
    expect(rows).toEqual([]);
    const key = `workspace/${s.workspaceId}/project/${s.project.id}/whiteboard/${board.id}/files/${assetId}`;
    expect(existsSync(resolveLocalPath(key.toLowerCase(), storageDir))).toBe(
      false,
    );
  });

  it("refuses SVG uploads and viewers' uploads", async () => {
    const board = await s.create(s.ben);
    const svg = await s.call(
      s.ben,
      `/whiteboard/${board.id}/assets`,
      json("POST", {
        filename: "x.svg",
        contentType: "image/svg+xml",
        size: 10,
      }),
    );
    expect(svg.status).toBe(400);
    const viewer = await s.call(
      s.viewer,
      `/whiteboard/${board.id}/assets`,
      json("POST", { filename: "x.png", contentType: "image/png", size: 10 }),
    );
    expect(viewer.status).toBe(403);
  });

  it("serves a published board's images only while the board shows them", async () => {
    await allowPublicPages(s.workspaceId, true);
    const board = await s.create(s.ben);
    const { assetId } = await upload(board.id, PNG);
    const hidden = await upload(board.id, PNG);
    const image = createElement("image", { assetId } as never);
    await s.ok(
      s.ben,
      `/whiteboard/${board.id}/elements`,
      json("POST", { elements: [image] }),
    );
    const { publicToken } = await s.ok<{ publicToken: string }>(
      s.admin,
      `/whiteboard/${board.id}/publication`,
      { method: "POST" },
    );
    mockAnonymousSession();
    const shown = await s.app.request(
      `/api/public-whiteboard/${publicToken}/assets/${assetId}`,
    );
    expect(shown.status).toBe(200);
    expect(shown.headers.get("content-type")).toBe("image/png");
    const unshown = await s.app.request(
      `/api/public-whiteboard/${publicToken}/assets/${hidden.assetId}`,
    );
    expect(unshown.status).toBe(404);
  });

  it("deletes stored images when the board is deleted for good", async () => {
    const board = await s.create(s.ben);
    const { assetId } = await upload(board.id, PNG);
    const [row] = await db
      .select()
      .from(schema.whiteboardAssetTable)
      .where(eq(schema.whiteboardAssetTable.id, assetId));
    const file = resolveLocalPath(row?.objectKey ?? "", storageDir);
    expect(existsSync(file)).toBe(true);
    await s.trash(s.ben, board.id);
    await s.ok(s.ben, `/trash/whiteboard/${board.id}`, { method: "DELETE" });
    expect(existsSync(file)).toBe(false);
    expect(
      await db
        .select()
        .from(schema.whiteboardAssetTable)
        .where(eq(schema.whiteboardAssetTable.id, assetId)),
    ).toEqual([]);
  });
});
