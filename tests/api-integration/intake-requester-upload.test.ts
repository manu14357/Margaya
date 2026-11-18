import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "./helpers/database";
import { intakeScene, json, setIntakeEnabled } from "./helpers/intake";

// The requester edits an open request's description (Edit request) and may
// put images and files in it, without task:update.
const upload = (
  taskId: string,
  surface: "description" | "comment" = "description",
) =>
  [
    `/task/image-upload/${taskId}`,
    json("PUT", {
      filename: "steps.png",
      contentType: "image/png",
      size: 1024,
      surface,
    }),
  ] as const;

describe("API integration: requester uploads into their request", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    process.env.S3_ENDPOINT = "https://storage.example.test";
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_ACCESS_KEY_ID = "test-access-key";
    process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
    delete process.env.S3_KEY_PREFIX;
  });

  afterEach(() => {
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
  });

  it("lets a viewer upload into their own open request", async () => {
    const scene = await intakeScene();
    const own = await scene.submit(scene.viewer, { title: "Viewer's" });

    const response = await scene.as(scene.viewer)(...upload(own.taskId));

    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toHaveProperty("uploadUrl");
  });

  it("refuses a requester's comment uploads, which need task:update", async () => {
    const scene = await intakeScene();
    const own = await scene.submit(scene.viewer, { title: "Viewer's" });

    expect(
      (await scene.as(scene.viewer)(...upload(own.taskId, "comment"))).status,
    ).toBe(403);
    expect(
      (await scene.as(scene.member)(...upload(own.taskId, "comment"))).status,
    ).toBe(200);
  });

  it("refuses a viewer on someone else's request and on board tasks", async () => {
    const scene = await intakeScene();
    const others = await scene.submit(scene.member, { title: "Member's" });
    const board = await scene.createBoardTask();

    expect(
      (await scene.as(scene.viewer)(...upload(others.taskId))).status,
    ).toBe(403);
    expect((await scene.as(scene.viewer)(...upload(board.id))).status).toBe(
      403,
    );
  });

  it("stops once the request is decided or intake is off", async () => {
    const scene = await intakeScene();
    const declined = await scene.submit(scene.viewer, { title: "Declined" });
    await scene.action(scene.member, declined.id, "decline");
    expect(
      (await scene.as(scene.viewer)(...upload(declined.taskId))).status,
    ).toBe(403);

    const open = await scene.submit(scene.viewer, { title: "Open" });
    await setIntakeEnabled(scene.project.id, false);
    expect((await scene.as(scene.viewer)(...upload(open.taskId))).status).toBe(
      403,
    );
  });

  it("keeps task:update the way for everyone else", async () => {
    const scene = await intakeScene();
    const own = await scene.submit(scene.viewer, { title: "Viewer's" });
    const board = await scene.createBoardTask();

    expect((await scene.as(scene.member)(...upload(own.taskId))).status).toBe(
      200,
    );
    expect((await scene.as(scene.member)(...upload(board.id))).status).toBe(
      200,
    );
    expect([403, 404]).toContain(
      (await scene.as(scene.outsider)(...upload(own.taskId))).status,
    );
  });
});
