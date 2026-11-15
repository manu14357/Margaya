import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Json,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Whiteboards: create, read, edit content, lock, archive, trash, restore,
// publish and the public read, per role, with the project feature switched
// off and the image upload type check, as the Whiteboards API exposes them.

type Whiteboard = Json & {
  projectId: string;
  title: string;
  icon: string | null;
  isLocked: boolean;
  archivedAt: string | null;
  publicToken: string | null;
  publishedAt: string | null;
  elementCount: number;
  contentVersion: number;
  capabilities: Record<string, boolean>;
};
type BoardElementJson = Record<string, unknown> & { id: string; type: string };
type Content = {
  elements: BoardElementJson[];
  settings: Record<string, unknown>;
  contentVersion: number;
};

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Whiteboards");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

function sticky(id: string, text: string, x = 0, y = 0): BoardElementJson {
  return { id, type: "sticky", x, y, width: 200, height: 200, text };
}

async function newBoard(
  actor: "owner" | "admin" | "member" = "member",
  data: Record<string, unknown> = {},
): Promise<Whiteboard> {
  return expectJson<Whiteboard>(
    await world.as(actor).post("/api/whiteboard", {
      data: { projectId: project.id, title: uniqueName("Board"), ...data },
    }),
    201,
  );
}

async function content(boardId: string): Promise<Content> {
  return expectJson<Content>(
    await world.as("viewer").get(`/api/whiteboard/${boardId}/content`),
  );
}

test(
  "create, read, list, rename, add elements, preview and duplicate a board",
  covers(
    "createWhiteboard",
    "getWhiteboard",
    "listWhiteboards",
    "updateWhiteboard",
    "getWhiteboardContent",
    "addWhiteboardElements",
    "getWhiteboardPreview",
    "duplicateWhiteboard",
  ),
  async () => {
    const member = world.as("member");
    const board = await newBoard("member", {
      icon: "🧭",
      elements: [sticky("seed-1", "Kick-off notes")],
    });
    expect(board).toMatchObject({
      projectId: project.id,
      icon: "🧭",
      isLocked: false,
      archivedAt: null,
      publicToken: null,
    });
    expect(board.capabilities.canEdit).toBe(true);

    const read = await expectJson<Whiteboard>(
      await world.as("viewer").get(`/api/whiteboard/${board.id}`),
    );
    expect(read.title).toBe(board.title);
    expect(read.capabilities.canEdit).toBe(false);

    const stored = await content(board.id);
    expect(stored.elements.map((el) => el.id)).toEqual(["seed-1"]);
    // Missing fields are filled from the defaults of the element type.
    expect(stored.elements[0]).toMatchObject({
      type: "sticky",
      text: "Kick-off notes",
      fillColor: "#fff3bf",
    });

    const added = await expectJson<Content>(
      await member.post(`/api/whiteboard/${board.id}/elements`, {
        data: {
          elements: [
            sticky("added-1", "Launch checklist", 300, 0),
            // Unknown fields are dropped; a non-finite number can't be parsed.
            { ...sticky("added-2", "Extra"), secret: "dropped" },
            { id: "broken", type: "rectangle", x: "nope" },
          ],
        },
      }),
    );
    expect(added.elements.map((el) => el.id).sort()).toEqual(
      ["added-1", "added-2"].sort(),
    );
    const after = await content(board.id);
    expect(after.elements.map((el) => el.id).sort()).toEqual(
      ["added-1", "added-2", "seed-1"].sort(),
    );
    expect(after.elements.find((el) => el.id === "added-2")).not.toHaveProperty(
      "secret",
    );

    const listed = await expectJson<{ whiteboards: Whiteboard[] }>(
      await world.as("viewer").get("/api/whiteboard", {
        params: { projectId: project.id },
      }),
    );
    expect(listed.whiteboards.map((entry) => entry.id)).toContain(board.id);

    // The list search matches the text on the board once it has been saved.
    await expect
      .poll(
        async () => {
          const found = await expectJson<{ whiteboards: Whiteboard[] }>(
            await member.get("/api/whiteboard", {
              params: { projectId: project.id, q: "launch checklist" },
            }),
          );
          return found.whiteboards.map((entry) => entry.id);
        },
        { timeout: 15_000 },
      )
      .toContain(board.id);

    const renamed = await expectJson<Whiteboard>(
      await member.patch(`/api/whiteboard/${board.id}`, {
        data: { title: "Launch board", icon: null },
      }),
    );
    expect(renamed).toMatchObject({ title: "Launch board", icon: null });
    await expectStatus(
      await member.patch(`/api/whiteboard/${board.id}`, {
        data: { icon: "not an emoji" },
      }),
      400,
    );

    const preview = await member.get(`/api/whiteboard/${board.id}/preview.svg`);
    expect(preview.status()).toBe(200);
    expect(preview.headers()["content-type"]).toContain("image/svg+xml");
    expect(preview.headers()["x-content-type-options"]).toBe("nosniff");
    const svg = await preview.text();
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("<script");

    const copy = await expectJson<Whiteboard>(
      await member.post(`/api/whiteboard/${board.id}/duplicate`, {
        data: { title: "Launch board (copy)" },
      }),
      201,
    );
    expect(copy.id).not.toBe(board.id);
    expect(copy.title).toBe("Launch board (copy)");
    const copied = await content(copy.id);
    expect(copied.elements).toHaveLength(3);
  },
);

test("a viewer reads but never writes", async () => {
  const board = await newBoard();
  const viewer = world.as("viewer");
  await expectStatus(
    await viewer.post("/api/whiteboard", {
      data: { projectId: project.id, title: "Viewer board" },
    }),
    403,
  );
  await expectStatus(
    await viewer.patch(`/api/whiteboard/${board.id}`, {
      data: { title: "Hijacked" },
    }),
    403,
  );
  await expectStatus(
    await viewer.post(`/api/whiteboard/${board.id}/elements`, {
      data: { elements: [sticky("viewer-1", "Nope")] },
    }),
    403,
  );
  for (const path of ["lock", "archive", "publication"]) {
    await expectStatus(
      await viewer.post(`/api/whiteboard/${board.id}/${path}`),
      403,
    );
  }
  await expectStatus(
    await viewer.post(`/api/whiteboard/${board.id}/assets`, {
      data: { filename: "a.png", contentType: "image/png", size: 100 },
    }),
    403,
  );
  await expectStatus(
    await world.as("anonymous").get(`/api/whiteboard/${board.id}`),
    401,
  );
  expect((await content(board.id)).elements).toHaveLength(0);
});

test(
  "lock blocks edits until unlocked",
  covers("lockWhiteboard", "unlockWhiteboard"),
  async () => {
    const member = world.as("member");
    const board = await newBoard();
    const locked = await expectJson<Whiteboard>(
      await member.post(`/api/whiteboard/${board.id}/lock`),
    );
    expect(locked.isLocked).toBe(true);
    expect(locked.capabilities.canEdit).toBe(false);

    await expectStatus(
      await member.post(`/api/whiteboard/${board.id}/elements`, {
        data: { elements: [sticky("locked-1", "Blocked")] },
      }),
      409,
    );
    await expectStatus(
      await member.patch(`/api/whiteboard/${board.id}`, {
        data: { title: "Blocked" },
      }),
      409,
    );
    // Another member did not create it and can't unlock it.
    await expectStatus(
      await world.as("viewer").delete(`/api/whiteboard/${board.id}/lock`),
      403,
    );

    const unlocked = await expectJson<Whiteboard>(
      await member.delete(`/api/whiteboard/${board.id}/lock`),
    );
    expect(unlocked.isLocked).toBe(false);
    await expectJson(
      await member.post(`/api/whiteboard/${board.id}/elements`, {
        data: { elements: [sticky("unlocked-1", "Allowed")] },
      }),
    );
  },
);

test(
  "archive, trash, restore from the trash and delete forever",
  covers(
    "archiveWhiteboard",
    "unarchiveWhiteboard",
    "deleteWhiteboard",
    "listWhiteboardTrash",
    "restoreDeletedWhiteboard",
    "purgeWhiteboard",
  ),
  async () => {
    const member = world.as("member");
    const admin = world.as("admin");
    const board = await newBoard();

    // Only archived boards go to the trash.
    await expectStatus(await member.delete(`/api/whiteboard/${board.id}`), 409);

    const archived = await expectJson<Whiteboard>(
      await member.post(`/api/whiteboard/${board.id}/archive`),
    );
    expect(archived.archivedAt).not.toBeNull();
    await expectStatus(
      await member.post(`/api/whiteboard/${board.id}/elements`, {
        data: { elements: [sticky("archived-1", "Blocked")] },
      }),
      409,
    );
    const archivedList = await expectJson<{ whiteboards: Whiteboard[] }>(
      await member.get("/api/whiteboard", {
        params: { projectId: project.id, archived: "true" },
      }),
    );
    expect(archivedList.whiteboards.map((entry) => entry.id)).toContain(
      board.id,
    );
    const liveList = await expectJson<{ whiteboards: Whiteboard[] }>(
      await member.get("/api/whiteboard", {
        params: { projectId: project.id },
      }),
    );
    expect(liveList.whiteboards.map((entry) => entry.id)).not.toContain(
      board.id,
    );

    const unarchived = await expectJson<Whiteboard>(
      await member.post(`/api/whiteboard/${board.id}/unarchive`),
    );
    expect(unarchived.archivedAt).toBeNull();
    await expectJson(await member.post(`/api/whiteboard/${board.id}/archive`));

    await expectJson(await member.delete(`/api/whiteboard/${board.id}`));
    await expectStatus(await member.get(`/api/whiteboard/${board.id}`), 404);

    const trash = await expectJson<{
      items: { id: string; canManage: boolean }[];
      total: number;
    }>(await member.get(`/api/trash/project/${project.id}/whiteboards`));
    const entry = trash.items.find((item) => item.id === board.id);
    expect(entry?.canManage).toBe(true);

    // A viewer sees the trash but can't restore.
    await expectStatus(
      await world
        .as("viewer")
        .post(`/api/trash/whiteboard/${board.id}/restore`),
      403,
    );
    const restored = await expectJson<Whiteboard>(
      await member.post(`/api/trash/whiteboard/${board.id}/restore`),
    );
    expect(restored.id).toBe(board.id);
    // A restored board comes back into the archive.
    expect(restored.archivedAt).not.toBeNull();
    await expectJson(await member.get(`/api/whiteboard/${board.id}`));

    await expectJson(await member.delete(`/api/whiteboard/${board.id}`));
    await expectJson(await admin.delete(`/api/trash/whiteboard/${board.id}`));
    await expectStatus(
      await admin.post(`/api/trash/whiteboard/${board.id}/restore`),
      404,
    );
  },
);

test(
  "publish, read the public link signed out, then unpublish",
  covers("publishWhiteboard", "unpublishWhiteboard", "getPublicWhiteboard"),
  async () => {
    const owner = world.as("owner");
    const task = await createTask(owner, project.id, {
      title: uniqueName("Public card"),
    });
    const board = await newBoard("member", {
      elements: [
        sticky("pub-1", "Visible to everyone"),
        {
          id: "card-1",
          type: "task",
          x: 300,
          y: 0,
          width: 280,
          height: 120,
          taskId: task.id,
        },
      ],
    });

    // Publishing needs whiteboard:delete, which members don't have.
    await expectStatus(
      await world.as("member").post(`/api/whiteboard/${board.id}/publication`),
      403,
    );
    // Like pages, publishing needs the workspace to allow public pages.
    await expectStatus(
      await owner.post(`/api/whiteboard/${board.id}/publication`),
      409,
    );
    await expectJson(
      await owner.patch(`/api/workspace/${world.workspace.id}/settings`, {
        data: { allowPublicPages: true },
      }),
    );
    const published = await expectJson<{
      publicToken: string;
      publishedAt: string;
    }>(await owner.post(`/api/whiteboard/${board.id}/publication`));
    expect(published.publicToken).toBeTruthy();

    // The token is shown only to people who can manage the board.
    const asViewer = await expectJson<Whiteboard>(
      await world.as("viewer").get(`/api/whiteboard/${board.id}`),
    );
    expect(asViewer.publicToken).toBeNull();
    expect(asViewer.publishedAt).not.toBeNull();

    const anonymous = world.as("anonymous");
    const publicBoard = await expectJson<{
      title: string;
      elements: BoardElementJson[];
      tasks: Record<string, { key: string; title: string; statusName: string }>;
    }>(await anonymous.get(`/api/public-whiteboard/${published.publicToken}`));
    expect(publicBoard.title).toBe(board.title);
    expect(publicBoard.elements.map((el) => el.id).sort()).toEqual(
      ["card-1", "pub-1"].sort(),
    );
    expect(publicBoard.tasks[task.id]).toMatchObject({ title: task.title });
    // Nothing about who edited the board leaks to the public.
    for (const element of publicBoard.elements) {
      expect(element.updatedBy).toBeNull();
    }

    // Publishing again rotates the token: the old link stops working.
    const republished = await expectJson<{ publicToken: string }>(
      await owner.post(`/api/whiteboard/${board.id}/publication`),
    );
    expect(republished.publicToken).not.toBe(published.publicToken);
    await expectStatus(
      await anonymous.get(`/api/public-whiteboard/${published.publicToken}`),
      404,
    );

    await expectJson(
      await owner.delete(`/api/whiteboard/${board.id}/publication`),
    );
    await expectStatus(
      await anonymous.get(`/api/public-whiteboard/${republished.publicToken}`),
      404,
    );
  },
);

test(
  "boards that contain a task are listed on it",
  covers("listTaskWhiteboards"),
  async () => {
    const owner = world.as("owner");
    const task = await createTask(owner, project.id);
    const board = await newBoard("member", {
      elements: [
        {
          id: "card-on-task",
          type: "task",
          x: 0,
          y: 0,
          width: 280,
          height: 120,
          taskId: task.id,
        },
      ],
    });
    await expect
      .poll(
        async () => {
          const listed = await expectJson<{ id: string }[] | Json>(
            await world.as("viewer").get(`/api/whiteboard/by-task/${task.id}`),
          );
          const items = Array.isArray(listed)
            ? listed
            : ((listed as { whiteboards?: { id: string }[] }).whiteboards ??
              []);
          return items.map((entry) => entry.id);
        },
        { timeout: 15_000 },
      )
      .toContain(board.id);
  },
);

test(
  "the workspace list holds boards of every project, with their project",
  covers("listWorkspaceWhiteboards"),
  async () => {
    const other = await createProject(world.as("owner"), world.workspace.id);
    const here = await newBoard("member", { title: uniqueName("Here") });
    const there = await expectJson<Whiteboard>(
      await world.as("member").post("/api/whiteboard", {
        data: { projectId: other.id, title: uniqueName("There") },
      }),
      201,
    );
    const listed = await expectJson<{
      whiteboards: (Whiteboard & { project: { id: string; name: string } })[];
    }>(
      await world
        .as("viewer")
        .get(`/api/whiteboard/workspace/${world.workspace.id}`),
    );
    const byId = new Map(listed.whiteboards.map((entry) => [entry.id, entry]));
    expect(byId.get(here.id)?.project.id).toBe(project.id);
    expect(byId.get(there.id)?.project.id).toBe(other.id);
    expect(byId.get(here.id)).not.toHaveProperty("capabilities");
  },
);

test("every whiteboard route answers 403 with the feature switched off", async () => {
  const owner = world.as("owner");
  const off = await createProject(owner, world.workspace.id);
  const board = await expectJson<Whiteboard>(
    await owner.post("/api/whiteboard", {
      data: { projectId: off.id, title: uniqueName("Feature board") },
    }),
    201,
  );
  await expectJson(
    await owner.patch(`/api/project/${off.id}/features`, {
      data: { whiteboardsEnabled: false },
    }),
  );
  try {
    await expectStatus(
      await owner.get("/api/whiteboard", { params: { projectId: off.id } }),
      403,
    );
    await expectStatus(
      await owner.post("/api/whiteboard", {
        data: { projectId: off.id, title: "Nope" },
      }),
      403,
    );
    for (const path of ["", "/content", "/preview.svg"]) {
      await expectStatus(
        await owner.get(`/api/whiteboard/${board.id}${path}`),
        403,
      );
    }
    await expectStatus(
      await owner.post(`/api/whiteboard/${board.id}/elements`, {
        data: { elements: [sticky("off-1", "Nope")] },
      }),
      403,
    );
    await expectStatus(
      await owner.post(`/api/whiteboard/${board.id}/lock`),
      403,
    );
    await expectStatus(
      await owner.get(`/api/trash/project/${off.id}/whiteboards`),
      403,
    );
  } finally {
    await expectJson(
      await owner.patch(`/api/project/${off.id}/features`, {
        data: { whiteboardsEnabled: true },
      }),
    );
  }
  await expectJson(await owner.get(`/api/whiteboard/${board.id}`));
});

test(
  "an image upload must really be an image",
  covers(
    "createWhiteboardAssetUpload",
    "finalizeWhiteboardAsset",
    "getWhiteboardAsset",
  ),
  async () => {
    const member = world.as("member");
    const board = await newBoard();

    // SVG is never accepted, even declared honestly.
    await expectStatus(
      await member.post(`/api/whiteboard/${board.id}/assets`, {
        data: {
          filename: "drawing.svg",
          contentType: "image/svg+xml",
          size: 100,
        },
      }),
      400,
    );

    // An SVG renamed to .png and declared as image/png.
    const fakePng = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const fake = await expectJson<{
      assetId: string;
      upload: { uploadUrl: string; headers: Record<string, string> };
    }>(
      await member.post(`/api/whiteboard/${board.id}/assets`, {
        data: {
          filename: "drawing.png",
          contentType: "image/png",
          size: fakePng.length,
        },
      }),
    );
    const put = await member.put(fake.upload.uploadUrl, {
      headers: fake.upload.headers,
      data: fakePng,
    });
    expect(put.status(), await put.text()).toBeLessThan(300);
    const rejected = await expectStatus(
      await member.post(
        `/api/whiteboard/${board.id}/assets/${fake.assetId}/finalize`,
        { data: { contentType: "image/png", size: fakePng.length } },
      ),
      400,
    );
    expect(rejected).toContain("not a PNG");
    await expectStatus(
      await member.get(`/api/whiteboard/${board.id}/assets/${fake.assetId}`),
      404,
    );

    // A real 1x1 PNG goes through and is served back as a PNG.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const real = await expectJson<{
      assetId: string;
      upload: { uploadUrl: string; headers: Record<string, string> };
    }>(
      await member.post(`/api/whiteboard/${board.id}/assets`, {
        data: {
          filename: "dot.png",
          contentType: "image/png",
          size: png.length,
        },
      }),
    );
    const putReal = await member.put(real.upload.uploadUrl, {
      headers: real.upload.headers,
      data: png,
    });
    expect(putReal.status(), await putReal.text()).toBeLessThan(300);
    await expectJson(
      await member.post(
        `/api/whiteboard/${board.id}/assets/${real.assetId}/finalize`,
        { data: { contentType: "image/png", size: png.length } },
      ),
    );
    const served = await world
      .as("viewer")
      .get(`/api/whiteboard/${board.id}/assets/${real.assetId}`);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("image/png");
    expect(served.headers()["x-content-type-options"]).toBe("nosniff");
  },
);

test(
  "shapes from the library, pen styles and the background read back with their defaults",
  covers("addWhiteboardElements", "getWhiteboardContent"),
  async () => {
    const member = world.as("member");
    const board = await newBoard();

    // A board created without settings reads back with a plain background at
    // the default spacing.
    const fresh = await content(board.id);
    expect(fresh.settings).toMatchObject({ pattern: "plain", patternSize: 24 });

    const added = await expectJson<Content & { skipped: number }>(
      await member.post(`/api/whiteboard/${board.id}/elements`, {
        data: {
          elements: [
            {
              id: "hex-1",
              type: "shape",
              shape: "hexagon",
              x: 0,
              y: 0,
              width: 160,
              height: 120,
              text: "Hexagon label",
            },
            // Not a shape the library knows: skipped, never stored.
            {
              id: "blob-1",
              type: "shape",
              shape: "blob",
              x: 200,
              y: 0,
              width: 100,
              height: 100,
            },
            // Saved before pen styles existed: no penStyle field.
            {
              id: "old-pen",
              type: "draw",
              x: 0,
              y: 200,
              width: 40,
              height: 10,
              points: [
                [0, 0],
                [20, 10],
                [40, 0],
              ],
            },
            {
              id: "marker-1",
              type: "draw",
              penStyle: "marker",
              x: 0,
              y: 300,
              width: 40,
              height: 10,
              points: [
                [0, 0],
                [40, 10],
              ],
            },
          ],
        },
      }),
    );
    expect(added.skipped).toBe(1);
    expect(added.elements.map((el) => el.id).sort()).toEqual(
      ["hex-1", "marker-1", "old-pen"].sort(),
    );

    const stored = await content(board.id);
    const byId = new Map(stored.elements.map((el) => [el.id, el]));
    expect(byId.get("hex-1")).toMatchObject({
      type: "shape",
      shape: "hexagon",
      text: "Hexagon label",
      width: 160,
      height: 120,
    });
    expect(byId.has("blob-1")).toBe(false);
    expect(byId.get("old-pen")).toMatchObject({
      type: "draw",
      penStyle: "pen",
    });
    expect(byId.get("marker-1")?.penStyle).toBe("marker");

    // Replacing the hexagon with an unknown kind is refused the same way and
    // leaves the stored shape alone.
    const refused = await expectJson<Content & { skipped: number }>(
      await member.post(`/api/whiteboard/${board.id}/elements`, {
        data: {
          elements: [
            {
              id: "hex-1",
              type: "shape",
              shape: "not-a-shape",
              x: 0,
              y: 0,
              width: 160,
              height: 120,
            },
          ],
        },
      }),
    );
    expect(refused).toMatchObject({ skipped: 1, elements: [] });
    expect(
      (await content(board.id)).elements.find((el) => el.id === "hex-1"),
    ).toMatchObject({ shape: "hexagon" });

    // Adding elements never touches the background.
    expect((await content(board.id)).settings).toMatchObject({
      pattern: "plain",
      patternSize: 24,
    });
  },
);
