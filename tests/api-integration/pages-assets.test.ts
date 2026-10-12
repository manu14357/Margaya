import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "../../apps/api/node_modules/@aws-sdk/client-s3";
import db, { schema } from "../../apps/api/src/database";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { json, type PageScene, pageScene } from "./helpers/pages";

function mockStorage() {
  const deleted: string[] = [];
  vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
    if (command instanceof HeadObjectCommand) {
      return { ContentLength: 12, ContentType: "image/png" } as never;
    }
    if (command instanceof DeleteObjectCommand) {
      deleted.push(command.input.Key as string);
      return {} as never;
    }
    if (command instanceof GetObjectCommand) {
      return {
        Body: {
          transformToWebStream: () =>
            new Blob([new Uint8Array([1, 2, 3])]).stream(),
        },
        ContentType: "image/png",
        ContentLength: 3,
      } as never;
    }
    throw new Error("unexpected storage call");
  });
  return deleted;
}

async function upload(s: PageScene, user: PageScene["ben"], pageId: string) {
  const body = { filename: "shot.png", contentType: "image/png", size: 12 };
  const presigned = await s.ok<{ key: string; uploadUrl: string }>(
    user,
    `/${pageId}/asset-upload`,
    json("PUT", body),
  );
  expect(presigned.key).toContain(`/page/${pageId}/files/`);
  return s.ok<{ id: string; url: string }>(
    user,
    `/${pageId}/asset-upload/finalize`,
    json("POST", { ...body, key: presigned.key }),
  );
}

async function assetRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.assetTable)
    .where(eq(schema.assetTable.id, id));
  return row;
}

describe("API integration: page files", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    vi.stubEnv("S3_ENDPOINT", "https://storage.example.test");
    vi.stubEnv("S3_BUCKET", "local-test-bucket");
    vi.stubEnv("S3_ACCESS_KEY_ID", "local-test-key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "local-test-secret");
    vi.stubEnv("S3_KEY_PREFIX", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("records uploads with the page, its project and surface page", async () => {
    mockStorage();
    const s = await pageScene();
    const page = await s.create(s.ben);
    const asset = await upload(s, s.ben, page.id);
    expect(asset.url).toMatch(new RegExp(`/asset/${asset.id}$`));
    expect(await assetRow(asset.id)).toMatchObject({
      pageId: page.id,
      projectId: s.project.id,
      taskId: null,
      surface: "page",
      kind: "image",
      createdBy: s.ben.id,
    });

    const wrongKey = await s.call(
      s.ben,
      `/${page.id}/asset-upload/finalize`,
      json("POST", {
        key: "workspace/x/project/y/page/z/files/a.png",
        filename: "a.png",
        contentType: "image/png",
        size: 12,
      }),
    );
    expect(wrongKey.status).toBe(400);
  });

  it("serves a private page's files to its owner only", async () => {
    mockStorage();
    const s = await pageScene();
    const page = await s.create(s.ben, { access: "private" });
    const asset = await upload(s, s.ben, page.id);

    mockAuthenticatedSession(s.cara);
    expect((await s.app.request(`/api/asset/${asset.id}`)).status).toBe(403);
    mockAuthenticatedSession(s.admin);
    expect((await s.app.request(`/api/asset/${asset.id}`)).status).toBe(403);
    mockAuthenticatedSession(s.ben);
    expect((await s.app.request(`/api/asset/${asset.id}`)).status).toBe(200);
  });

  it("hands linked files to another page on delete and removes the rest", async () => {
    const deleted = mockStorage();
    const s = await pageScene();
    const page = await s.create(s.ben);
    const kept = await upload(s, s.ben, page.id);
    const dropped = await upload(s, s.ben, page.id);
    await s.ok(
      s.ben,
      `/${page.id}/content`,
      json("PUT", {
        markdown: `![shot](https://margaya.test/api/asset/${kept.id})`,
      }),
    );
    const copy = await s.ok(s.ben, `/${page.id}/duplicate`, { method: "POST" });

    await s.ok(s.ben, `/${page.id}/archive`, { method: "POST" });
    await s.ok(s.ben, `/${page.id}`, { method: "DELETE" });

    expect(await assetRow(kept.id)).toMatchObject({ pageId: copy.id });
    expect(await assetRow(dropped.id)).toBeUndefined();
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain(`/page/${page.id}/files/`);
  });
});
