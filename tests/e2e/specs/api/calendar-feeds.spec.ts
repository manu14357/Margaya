import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Calendar (ICS) subscription feeds: create, fetch without a session,
// regenerate and revoke. Fetching uses only the secret URL token.

type CreatedFeed = {
  id: string;
  kind: string;
  url: string;
  webcalUrl: string;
  tokenStart: string;
};

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Calendar feeds");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

const feedPath = (url: string) => new URL(url).pathname;

test(
  "create, list, fetch, regenerate and revoke a my-tasks feed",
  covers(
    "createWorkspaceCalendarFeed",
    "listCalendarFeeds",
    "getCalendarFeed",
    "revokeCalendarFeed",
  ),
  async () => {
    const member = world.as("member");
    const title = uniqueName("Feed task");
    await createTask(world.as("owner"), project.id, {
      title,
      assigneeIds: [world.users.member.id],
      dueDate: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });

    const created = await expectJson<CreatedFeed>(
      await member.post(`/api/calendar-feed/workspace/${world.workspace.id}`, {
        data: { kind: "my_tasks", name: "My tasks" },
      }),
    );
    expect(created.kind).toBe("my_tasks");

    const list = await expectJson<CreatedFeed[]>(
      await member.get(`/api/calendar-feed/workspace/${world.workspace.id}`),
    );
    expect(list.map((feed) => feed.id)).toContain(created.id);
    expect(JSON.stringify(list)).not.toContain(created.url);

    const feed = await world.anonymous.get(feedPath(created.url));
    expect(feed.status()).toBe(200);
    expect(feed.headers()["content-type"]).toContain("text/calendar");
    expect(await feed.text()).toContain(title);

    const regenerated = await expectJson<CreatedFeed>(
      await member.post(`/api/calendar-feed/workspace/${world.workspace.id}`, {
        data: { kind: "my_tasks", name: "My tasks" },
      }),
    );
    expect(regenerated.url).not.toBe(created.url);
    await expectStatus(await world.anonymous.get(feedPath(created.url)), 404);

    await expectJson(
      await member.delete(`/api/calendar-feed/${regenerated.id}`),
    );
    await expectStatus(
      await world.anonymous.get(feedPath(regenerated.url)),
      404,
    );
  },
);

test(
  "a project feed carries the project's dated tasks",
  covers("createProjectCalendarFeed"),
  async () => {
    const owner = world.as("owner");
    const title = uniqueName("Project feed task");
    await createTask(owner, project.id, {
      title,
      dueDate: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });
    const created = await expectJson<CreatedFeed>(
      await world
        .as("viewer")
        .post(`/api/calendar-feed/project/${project.id}`, {
          data: { name: "Project" },
        }),
    );
    const body = await (
      await world.anonymous.get(feedPath(created.url))
    ).text();
    expect(body).toContain(title);
    await expectStatus(
      await world.anonymous.post(`/api/calendar-feed/project/${project.id}`, {
        data: { name: "x" },
      }),
      [401, 403],
    );
  },
);
