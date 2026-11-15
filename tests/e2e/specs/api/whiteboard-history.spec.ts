import { expect, test } from "../../fixtures";
import {
  createProject,
  createWorld,
  expectJson,
  expectStatus,
  type Json,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// A whiteboard's history: lifecycle entries with their actor, readable by
// viewers, written after the change (so the test polls).

type ActivityPage = {
  items: Array<{
    action: string;
    actor: { id: string; name: string } | null;
    title: string | null;
  }>;
  nextCursor: string | null;
};

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Whiteboard history");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "lists a board's lifecycle changes, newest first, for viewers",
  covers("listWhiteboardActivity"),
  async () => {
    const member = world.as("member");
    const title = uniqueName("History board");
    const board = await expectJson<Json & { id: string }>(
      await member.post("/api/whiteboard", {
        data: { projectId: project.id, title },
      }),
      201,
    );
    await expectJson(
      await member.patch(`/api/whiteboard/${board.id}`, {
        data: { title: `${title} v2` },
      }),
    );
    await expectJson(await member.post(`/api/whiteboard/${board.id}/lock`));

    const read = async () =>
      expectJson<ActivityPage>(
        await world.as("viewer").get(`/api/whiteboard/${board.id}/activity`),
      );
    await expect
      .poll(async () => (await read()).items.map((item) => item.action))
      .toEqual(["locked", "renamed", "created"]);
    const page = await read();
    expect(page.nextCursor).toBeNull();
    expect(page.items[1]).toMatchObject({ title: `${title} v2` });
    expect(page.items[2]?.actor).not.toBeNull();

    await expectStatus(
      await world
        .as("viewer")
        .get(`/api/whiteboard/${board.id}/activity?cursor=nonsense`),
      400,
    );
  },
);
