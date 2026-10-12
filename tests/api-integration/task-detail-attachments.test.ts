import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S3Client } from "../../apps/api/node_modules/@aws-sdk/client-s3";
import db, { schema } from "../../apps/api/src/database";
import { taskAttachmentCountSql } from "../../apps/api/src/task-attachment/counts";
import { mockAnonymousSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  clearPublishedEvents,
  json,
  publishedEvents,
  recordEvents,
  taskDetailScene,
} from "./helpers/task-detail";

type AttachmentJson = {
  id: string;
  taskId: string;
  filename: string;
  mimeType: string;
  size: number;
  kind: "image" | "attachment";
  url: string;
  downloadUrl: string;
  createdBy: { id: string; name: string } | null;
};

recordEvents("task.attachment_added", "task.attachment_removed");

/** Storage objects by key; HEAD answers from here. */
let stored: Map<string, { size: number; type: string }>;
let send: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await resetTestDatabase();
  clearPublishedEvents();
  process.env.S3_ENDPOINT = "https://storage.example.test";
  process.env.S3_BUCKET = "test-bucket";
  process.env.S3_ACCESS_KEY_ID = "test-access-key";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.MARGAYA_API_URL = "http://localhost:1337";
  delete process.env.S3_KEY_PREFIX;
  delete process.env.S3_MAX_IMAGE_UPLOAD_BYTES;
  stored = new Map();
  send = vi.fn(
    async (command: {
      constructor: { name: string };
      input: { Key: string };
    }) => {
      const name = command.constructor.name;
      if (name === "HeadObjectCommand") {
        const object = stored.get(command.input.Key);
        if (!object)
          throw Object.assign(new Error("missing"), { name: "NotFound" });
        return { ContentLength: object.size, ContentType: object.type };
      }
      if (name === "GetObjectCommand") {
        return {
          Body: {
            transformToWebStream: () =>
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new Uint8Array([1, 2, 3]));
                  controller.close();
                },
              }),
          },
          ContentType: stored.get(command.input.Key)?.type,
          ContentLength: 3,
        };
      }
      return {};
    },
  );
  vi.spyOn(S3Client.prototype, "send").mockImplementation(send as never);
});

afterEach(() => {
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
});

function commandsSent(name: string) {
  return send.mock.calls
    .map(
      ([command]) =>
        command as { constructor: { name: string }; input: { Key: string } },
    )
    .filter((command) => command.constructor.name === name);
}

async function scene() {
  const s = await taskDetailScene();
  const task = await s.createTask();
  const asMember = s.as(s.member);

  /** The three steps a browser takes, with the PUT simulated in storage. */
  const attach = async (
    request: typeof asMember,
    file: { filename: string; contentType: string; size: number },
  ) => {
    const upload = await request(
      `/task-attachment/${task.id}/upload`,
      json("POST", file),
    );
    expect(upload.status).toBe(200);
    const { key } = (await upload.json()) as { key: string };
    stored.set(key, {
      size: file.size,
      type: file.contentType || "application/octet-stream",
    });
    const finalize = await request(
      `/task-attachment/${task.id}/finalize`,
      json("POST", { key, ...file }),
    );
    return { key, finalize };
  };

  return { ...s, task, asMember, attach };
}

const pdf = {
  filename: "Report.pdf",
  contentType: "application/pdf",
  size: 2048,
};
const png = { filename: "shot.png", contentType: "image/png", size: 512 };

describe("task attachment uploads", () => {
  it("issues a key in the task's attachments folder", async () => {
    const { asMember, task, workspace, project } = await scene();
    const response = await asMember(
      `/task-attachment/${task.id}/upload`,
      json("POST", pdf),
    );
    expect(response.status).toBe(200);
    const upload = (await response.json()) as {
      key: string;
      uploadUrl: string;
      headers: Record<string, string>;
    };
    expect(
      upload.key.startsWith(
        `workspace/${workspace.id.toLowerCase()}/project/${project.id}/task/${task.id}/attachments/report-`,
      ),
    ).toBe(true);
    expect(upload.headers).toEqual({ "Content-Type": "application/pdf" });
    expect(upload.uploadUrl).toContain("storage.example.test");
  });

  it("answers 503 without storage and 400 over the size limit", async () => {
    const { asMember, task } = await scene();
    process.env.S3_MAX_IMAGE_UPLOAD_BYTES = "1000";
    const tooBig = await asMember(
      `/task-attachment/${task.id}/upload`,
      json("POST", pdf),
    );
    expect(tooBig.status).toBe(400);
    expect(await tooBig.text()).toContain("maximum upload size");

    delete process.env.S3_MAX_IMAGE_UPLOAD_BYTES;
    delete process.env.S3_ENDPOINT;
    const off = await asMember(
      `/task-attachment/${task.id}/upload`,
      json("POST", pdf),
    );
    expect(off.status).toBe(503);
    expect(await off.text()).toBe(
      "File uploads are not configured on this instance",
    );
  });

  it("records a verified upload, once, with its kind and sanitized name", async () => {
    const { asMember, attach, member, task, project } = await scene();
    const { key, finalize } = await attach(asMember, {
      ...pdf,
      filename: "../q3\u0001 report.pdf",
    });
    expect(finalize.status).toBe(200);
    const attachment = (await finalize.json()) as AttachmentJson;
    expect(attachment).toMatchObject({
      taskId: task.id,
      filename: "..q3 report.pdf",
      mimeType: "application/pdf",
      size: 2048,
      kind: "attachment",
      url: `http://localhost:1337/api/asset/${attachment.id}`,
      downloadUrl: `http://localhost:1337/api/asset/${attachment.id}?download=1`,
      createdBy: { id: member.id, name: "Ben" },
    });
    const [row] = await db
      .select()
      .from(schema.assetTable)
      .where(eq(schema.assetTable.id, attachment.id));
    expect(row).toMatchObject({
      surface: "attachment",
      objectKey: key,
      projectId: project.id,
    });

    const again = await asMember(
      `/task-attachment/${task.id}/finalize`,
      json("POST", { key, ...pdf }),
    );
    expect(again.status).toBe(200);
    expect(((await again.json()) as AttachmentJson).id).toBe(attachment.id);
    expect(
      publishedEvents("task.attachment_added").map((event) => event.data),
    ).toEqual([
      expect.objectContaining({
        taskId: task.id,
        projectId: project.id,
        userId: member.id,
        attachmentId: attachment.id,
        filename: "..q3 report.pdf",
        size: 2048,
        mimeType: "application/pdf",
      }),
    ]);

    const image = (await (
      await attach(asMember, png)
    ).finalize.json()) as AttachmentJson;
    expect(image.kind).toBe("image");
  });

  it("refuses keys of another surface or task, and unverified objects", async () => {
    const { asMember, task, createTask, workspace, project } = await scene();
    const descriptionKey = `workspace/${workspace.id.toLowerCase()}/project/${project.id}/task/${task.id}/descriptions/a.png`;
    stored.set(descriptionKey, { size: 512, type: "image/png" });
    const wrongSurface = await asMember(
      `/task-attachment/${task.id}/finalize`,
      json("POST", { key: descriptionKey, ...png }),
    );
    expect(wrongSurface.status).toBe(400);
    expect(await wrongSurface.text()).toBe(
      "Upload key does not match this task",
    );

    const other = await createTask();
    const otherKey = `workspace/${workspace.id.toLowerCase()}/project/${project.id}/task/${other.id}/attachments/a.pdf`;
    const wrongTask = await asMember(
      `/task-attachment/${task.id}/finalize`,
      json("POST", { key: otherKey, ...pdf }),
    );
    expect(wrongTask.status).toBe(400);

    const missingKey = `workspace/${workspace.id.toLowerCase()}/project/${project.id}/task/${task.id}/attachments/never-uploaded.pdf`;
    const missing = await asMember(
      `/task-attachment/${task.id}/finalize`,
      json("POST", { key: missingKey, ...pdf }),
    );
    expect(missing.status).toBe(400);
    expect(await missing.text()).toBe("Uploaded object was not found.");
    expect(await db.select().from(schema.assetTable)).toEqual([]);
  });

  it("lists only panel attachments, newest first", async () => {
    const { asMember, attach, task, workspace, project } = await scene();
    await db.insert(schema.assetTable).values({
      workspaceId: workspace.id,
      projectId: project.id,
      taskId: task.id,
      objectKey: "inline-image",
      filename: "inline.png",
      mimeType: "image/png",
      size: 10,
      surface: "description",
    });
    await attach(asMember, pdf);
    await attach(asMember, png);

    const response = await asMember(`/task-attachment/${task.id}`);
    expect(response.status).toBe(200);
    const list = (await response.json()) as AttachmentJson[];
    expect(list.map((attachment) => attachment.filename)).toEqual([
      "shot.png",
      "Report.pdf",
    ]);

    const [count] = await db
      .select({ attachments: taskAttachmentCountSql })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    expect(count?.attachments).toBe(2);
  });

  it("caps a task at 100 attachments on upload and on finalize", async () => {
    const { asMember, task, workspace, project } = await scene();
    const upload = await asMember(
      `/task-attachment/${task.id}/upload`,
      json("POST", pdf),
    );
    const { key } = (await upload.json()) as { key: string };
    stored.set(key, { size: pdf.size, type: pdf.contentType });

    await db.insert(schema.assetTable).values(
      Array.from({ length: 100 }, (_, index) => ({
        workspaceId: workspace.id,
        projectId: project.id,
        taskId: task.id,
        objectKey: `filler-${index}`,
        filename: `f${index}.txt`,
        mimeType: "text/plain",
        size: 1,
        kind: "attachment",
        surface: "attachment",
      })),
    );

    const early = await asMember(
      `/task-attachment/${task.id}/upload`,
      json("POST", pdf),
    );
    expect(early.status).toBe(400);
    expect(await early.text()).toBe("A task can have at most 100 attachments");

    const late = await asMember(
      `/task-attachment/${task.id}/finalize`,
      json("POST", { key, ...pdf }),
    );
    expect(late.status).toBe(400);
    expect(await late.text()).toBe("A task can have at most 100 attachments");
    expect(
      commandsSent("DeleteObjectCommand").map((command) => command.input.Key),
    ).toEqual([key]);
  });

  it("lets viewers read but not upload", async () => {
    const { as, viewer, task } = await scene();
    const asViewer = as(viewer);
    expect((await asViewer(`/task-attachment/${task.id}`)).status).toBe(200);
    expect(
      (await asViewer(`/task-attachment/${task.id}/upload`, json("POST", pdf)))
        .status,
    ).toBe(403);
  });
});

describe("task attachment deletes", () => {
  it("lets the uploader and admins delete, but not other members", async () => {
    const { as, asMember, attach, admin, member, task, workspace, project } =
      await scene();
    const own = (await (
      await attach(asMember, pdf)
    ).finalize.json()) as AttachmentJson;
    const asAdmin = as(admin);
    const byAdmin = (await (
      await attach(asAdmin, png)
    ).finalize.json()) as AttachmentJson;

    const forbidden = await asMember(
      `/task-attachment/${task.id}/${byAdmin.id}`,
      {
        method: "DELETE",
      },
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.text()).toBe(
      "Only the uploader or someone who can delete tasks can remove this attachment",
    );

    const [ownRow] = await db
      .select({ objectKey: schema.assetTable.objectKey })
      .from(schema.assetTable)
      .where(eq(schema.assetTable.id, own.id));
    const deleted = await asMember(`/task-attachment/${task.id}/${own.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ id: own.id });
    expect(
      commandsSent("DeleteObjectCommand").map((command) => command.input.Key),
    ).toEqual([ownRow?.objectKey]);
    expect(
      publishedEvents("task.attachment_removed").map((event) => event.data),
    ).toEqual([
      expect.objectContaining({
        taskId: task.id,
        projectId: project.id,
        userId: member.id,
        attachmentId: own.id,
        filename: "Report.pdf",
      }),
    ]);

    expect(
      (
        await asAdmin(`/task-attachment/${task.id}/${byAdmin.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    expect(
      await db
        .select()
        .from(schema.assetTable)
        .where(eq(schema.assetTable.workspaceId, workspace.id)),
    ).toEqual([]);
  });

  it("scopes deletes to the task in the path", async () => {
    const { asMember, attach, createTask } = await scene();
    const other = await createTask();
    const attachment = (await (
      await attach(asMember, pdf)
    ).finalize.json()) as AttachmentJson;
    const response = await asMember(
      `/task-attachment/${other.id}/${attachment.id}`,
      {
        method: "DELETE",
      },
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Attachment not found");
  });
});

describe("task attachment downloads", () => {
  it("serves members, never anonymous viewers of a public project, and forces downloads on request", async () => {
    const { app, asMember, attach, project } = await scene();
    await db
      .update(schema.projectTable)
      .set({ isPublic: true })
      .where(eq(schema.projectTable.id, project.id));
    const image = (await (
      await attach(asMember, png)
    ).finalize.json()) as AttachmentJson;

    const inline = await asMember(`/asset/${image.id}`);
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-disposition")).toMatch(/^inline;/);

    const forced = await asMember(`/asset/${image.id}?download=1`);
    expect(forced.status).toBe(200);
    expect(forced.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(forced.headers.get("content-type")).toBe("application/octet-stream");

    mockAnonymousSession();
    const anonymous = await app.request(`/api/asset/${image.id}`);
    expect(anonymous.status).toBe(401);
  });
});

describe("description cleanup", () => {
  it("never deletes an attachment whose URL left the description", async () => {
    const { asMember, attach, task, workspace, project } = await scene();
    const attachment = (await (
      await attach(asMember, pdf)
    ).finalize.json()) as AttachmentJson;
    const [inline] = await db
      .insert(schema.assetTable)
      .values({
        workspaceId: workspace.id,
        projectId: project.id,
        taskId: task.id,
        objectKey: "inline-image-key",
        filename: "inline.png",
        mimeType: "image/png",
        size: 10,
        surface: "description",
      })
      .returning();

    const pasted = `See ${attachment.url} and ![x](http://localhost:1337/api/asset/${inline?.id})`;
    for (const description of [pasted, "Nothing here any more"]) {
      const response = await asMember(
        `/task/description/${task.id}`,
        json("PUT", { description }),
      );
      expect(response.status).toBe(200);
    }

    // The control: the inline image is cleaned up in the background.
    await vi.waitFor(
      async () =>
        expect(
          await db
            .select()
            .from(schema.assetTable)
            .where(eq(schema.assetTable.id, inline?.id ?? "")),
        ).toEqual([]),
      { timeout: 5000, interval: 25 },
    );
    expect(
      await db
        .select()
        .from(schema.assetTable)
        .where(eq(schema.assetTable.id, attachment.id)),
    ).toHaveLength(1);
    expect(
      commandsSent("DeleteObjectCommand").map((command) => command.input.Key),
    ).toEqual(["inline-image-key"]);
  });
});
