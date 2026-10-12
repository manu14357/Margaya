import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { taskLinkCountSql } from "../../apps/api/src/task-link/counts";
import { resetTestDatabase } from "./helpers/database";
import {
  clearPublishedEvents,
  json,
  publishedEvents,
  recordEvents,
  taskDetailScene,
} from "./helpers/task-detail";

type LinkJson = {
  id: string;
  taskId: string;
  url: string;
  title: string | null;
  host: string;
  createdBy: { id: string; name: string; image: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

recordEvents("task.link_created", "task.link_updated", "task.link_deleted");

beforeEach(async () => {
  await resetTestDatabase();
  clearPublishedEvents();
});

async function scene() {
  const s = await taskDetailScene();
  const task = await s.createTask({ title: "Write the spec" });
  const asMember = s.as(s.member);
  const addLink = async (url: string, title?: string | null) =>
    asMember(`/task-link/${task.id}`, json("POST", { url, title }));
  return { ...s, task, asMember, addLink };
}

describe("task links", () => {
  it("normalizes the URL and title and names who added it", async () => {
    const { addLink, member, task } = await scene();

    const response = await addLink("example.com/spec", "  Spec  ");
    expect(response.status).toBe(200);
    const link = (await response.json()) as LinkJson;
    expect(link).toMatchObject({
      taskId: task.id,
      url: "https://example.com/spec",
      title: "Spec",
      host: "example.com",
      createdBy: { id: member.id, name: "Ben" },
    });

    const untitled = (await (
      await addLink("https://www.example.org", "   ")
    ).json()) as LinkJson;
    expect(untitled).toMatchObject({
      url: "https://www.example.org/",
      title: null,
      host: "example.org",
    });
  });

  it("lists newest first", async () => {
    const { addLink, asMember, task } = await scene();
    await addLink("https://one.example.com");
    await addLink("https://two.example.com");
    await addLink("https://three.example.com");

    const response = await asMember(`/task-link/${task.id}`);
    expect(response.status).toBe(200);
    const links = (await response.json()) as LinkJson[];
    expect(links.map((link) => link.host)).toEqual([
      "three.example.com",
      "two.example.com",
      "one.example.com",
    ]);
  });

  it("refuses the same page twice, after normalizing", async () => {
    const { addLink, asMember, task } = await scene();
    expect((await addLink("https://example.com/")).status).toBe(200);

    const duplicate = await addLink("example.com");
    expect(duplicate.status).toBe(409);
    expect(await duplicate.text()).toBe("This link is already on this task");

    const other = (await (
      await addLink("https://example.com/b")
    ).json()) as LinkJson;
    const clash = await asMember(
      `/task-link/${task.id}/${other.id}`,
      json("PATCH", { url: "EXAMPLE.com" }),
    );
    expect(clash.status).toBe(409);
    expect(await clash.text()).toBe("This link is already on this task");

    const keep = await asMember(
      `/task-link/${task.id}/${other.id}`,
      json("PATCH", { url: "https://example.com/b", title: "B" }),
    );
    expect(keep.status).toBe(200);
    expect(await keep.json()).toMatchObject({ title: "B" });
  });

  it.each([
    ["javascript:alert(1)", "Enter a valid http or https URL"],
    ["data:text/html,hi", "Enter a valid http or https URL"],
    ["ftp://example.com/file", "Enter a valid http or https URL"],
    ["https://exa mple.com", "Enter a valid http or https URL"],
    ["https://intranet/page", "Enter a valid http or https URL"],
    [
      "https://user:secret@example.com",
      "Links can't contain a user name or password",
    ],
    ["   ", "URL is required"],
    [
      `https://example.com/${"a".repeat(2029)}`,
      "Links can be at most 2,048 characters",
    ],
  ])("refuses %s", async (url, message) => {
    const { addLink } = await scene();
    const response = await addLink(url);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(message);
  });

  it("accepts localhost and IP literals, and titles up to 255 characters", async () => {
    const { addLink } = await scene();
    for (const url of [
      "http://localhost:3000",
      "http://10.1.2.3/wiki",
      "http://[::1]/",
    ]) {
      expect((await addLink(url)).status, url).toBe(200);
    }
    const long = await addLink("https://titles.example.com", "t".repeat(256));
    expect(long.status).toBe(400);
    expect(await long.text()).toBe("Titles can be at most 255 characters");
  });

  it("caps a task at 100 links", async () => {
    const { addLink, task } = await scene();
    await db.insert(schema.taskLinkTable).values(
      Array.from({ length: 100 }, (_, index) => ({
        taskId: task.id,
        url: `https://example.com/${index}`,
      })),
    );
    const response = await addLink("https://example.com/one-more");
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("A task can have at most 100 links");
  });

  it("scopes links to the task in the path", async () => {
    const { addLink, asMember, createTask } = await scene();
    const other = await createTask();
    const link = (await (
      await addLink("https://example.com")
    ).json()) as LinkJson;

    for (const init of [json("PATCH", { title: "x" }), { method: "DELETE" }]) {
      const response = await asMember(
        `/task-link/${other.id}/${link.id}`,
        init,
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Link not found");
    }
  });

  it("needs a URL or a title to update", async () => {
    const { addLink, asMember, task } = await scene();
    const link = (await (
      await addLink("https://example.com")
    ).json()) as LinkJson;
    const response = await asMember(
      `/task-link/${task.id}/${link.id}`,
      json("PATCH", {}),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Provide a URL or a title");
  });

  it("lets viewers read but not change links, and keeps outsiders out", async () => {
    const { addLink, as, viewer, outsider, task } = await scene();
    const link = (await (
      await addLink("https://example.com")
    ).json()) as LinkJson;
    const asViewer = as(viewer);

    expect((await asViewer(`/task-link/${task.id}`)).status).toBe(200);
    expect(
      (
        await asViewer(
          `/task-link/${task.id}`,
          json("POST", { url: "https://x.example" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await asViewer(
          `/task-link/${task.id}/${link.id}`,
          json("PATCH", { title: "x" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await asViewer(`/task-link/${task.id}/${link.id}`, { method: "DELETE" }))
        .status,
    ).toBe(403);
    expect((await as(outsider)(`/task-link/${task.id}`)).status).toBe(403);
  });

  it("publishes the change events, and nothing for a no-op update", async () => {
    const { addLink, asMember, member, project, task } = await scene();
    const link = (await (
      await addLink("example.com", "Spec")
    ).json()) as LinkJson;
    expect(
      publishedEvents("task.link_created").map((event) => event.data),
    ).toEqual([
      expect.objectContaining({
        taskId: task.id,
        projectId: project.id,
        userId: member.id,
        linkId: link.id,
        url: "https://example.com/",
        title: "Spec",
        host: "example.com",
      }),
    ]);

    const noop = await asMember(
      `/task-link/${task.id}/${link.id}`,
      json("PATCH", { url: "https://example.com", title: " Spec " }),
    );
    expect(noop.status).toBe(200);
    expect(((await noop.json()) as LinkJson).updatedAt).toBe(link.updatedAt);
    expect(publishedEvents("task.link_updated")).toHaveLength(0);

    await asMember(
      `/task-link/${task.id}/${link.id}`,
      json("PATCH", { url: "https://docs.example.com/v2", title: null }),
    );
    expect(
      publishedEvents("task.link_updated").map((event) => event.data),
    ).toEqual([
      expect.objectContaining({
        linkId: link.id,
        url: "https://docs.example.com/v2",
        title: null,
        host: "docs.example.com",
        oldUrl: "https://example.com/",
        oldTitle: "Spec",
      }),
    ]);

    const removed = await asMember(`/task-link/${task.id}/${link.id}`, {
      method: "DELETE",
    });
    expect(await removed.json()).toEqual({ id: link.id });
    expect(
      publishedEvents("task.link_deleted").map((event) => event.data),
    ).toEqual([
      expect.objectContaining({
        linkId: link.id,
        url: "https://docs.example.com/v2",
        host: "docs.example.com",
      }),
    ]);
  });

  it("goes with its task, and outlives its creator", async () => {
    const { addLink, member, task, createTask } = await scene();
    const kept = await createTask();
    await addLink("https://example.com");
    await db.insert(schema.taskLinkTable).values({
      taskId: kept.id,
      url: "https://kept.example.com/",
      createdBy: member.id,
    });

    await db.delete(schema.taskTable).where(eq(schema.taskTable.id, task.id));
    expect(
      await db
        .select()
        .from(schema.taskLinkTable)
        .where(eq(schema.taskLinkTable.taskId, task.id)),
    ).toEqual([]);

    await db.delete(schema.userTable).where(eq(schema.userTable.id, member.id));
    const [row] = await db
      .select()
      .from(schema.taskLinkTable)
      .where(eq(schema.taskLinkTable.taskId, kept.id));
    expect(row?.createdBy).toBeNull();
  });

  it("counts a task's links for display properties", async () => {
    const { addLink, task } = await scene();
    await addLink("https://one.example.com");
    await addLink("https://two.example.com");
    const [row] = await db
      .select({ links: taskLinkCountSql })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    expect(row?.links).toBe(2);
  });
});
