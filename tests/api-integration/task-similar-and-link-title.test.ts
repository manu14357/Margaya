import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { linkTitleAutofill } from "../../apps/api/src/task-link/title-autofill";
import { resetTestDatabase } from "./helpers/database";
import {
  clearPublishedEvents,
  json,
  publishedEvents,
  recordEvents,
  taskDetailScene,
} from "./helpers/task-detail";

recordEvents("task.link_updated");

const original = { ...linkTitleAutofill };

beforeEach(async () => {
  await resetTestDatabase();
  clearPublishedEvents();
});

afterEach(() => {
  Object.assign(linkTitleAutofill, original);
});

type SimilarJson = {
  tasks: { id: string; key: string; title: string; status: string }[];
};

describe("similar tasks while typing a title", () => {
  it("lists open tasks that share most words, best first", async () => {
    const s = await taskDetailScene();
    const login = await s.createTask({ title: "Login page breaks on Safari" });
    const partial = await s.createTask({ title: "Safari login is slow" });
    await s.createTask({ title: "Update the pricing page" });
    await s.createTask({ title: "Login page Safari crash", status: "done" });
    await s.createTask({
      title: "Login page Safari archived",
      archivedAt: new Date(),
    });

    const response = await s.as(s.member)(
      `/task/similar/${s.project.id}?q=${encodeURIComponent("Safari login page broken")}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as SimilarJson;
    expect(body.tasks.map((task) => task.id)).toEqual([login.id, partial.id]);
    expect(body.tasks[0]?.key).toBe("WEB-1");
  });

  it("answers nothing for a single word and refuses outsiders", async () => {
    const s = await taskDetailScene();
    await s.createTask({ title: "Login page" });

    const short = await s.as(s.member)(`/task/similar/${s.project.id}?q=login`);
    expect(((await short.json()) as SimilarJson).tasks).toEqual([]);

    const outsider = await s.as(s.outsider)(
      `/task/similar/${s.project.id}?q=login+page`,
    );
    expect(outsider.status).toBe(403);
  });
});

describe("link title auto-fill", () => {
  it("fills the title of an untitled link and publishes the update", async () => {
    const s = await taskDetailScene();
    const task = await s.createTask();
    // The page answers only after the add returned, like a real fetch.
    let release = () => {};
    const answered = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchTitle = vi.fn(async () => {
      await answered;
      return "The Spec";
    });
    Object.assign(linkTitleAutofill, { enabled: true, fetchTitle });

    const response = await s.as(s.member)(
      `/task-link/${task.id}`,
      json("POST", { url: "https://example.com/spec" }),
    );
    expect(response.status).toBe(200);
    const created = (await response.json()) as { id: string; title: null };
    expect(created.title).toBeNull();
    release();

    await vi.waitFor(async () => {
      const [row] = await db
        .select({ title: schema.taskLinkTable.title })
        .from(schema.taskLinkTable)
        .where(eq(schema.taskLinkTable.id, created.id));
      expect(row?.title).toBe("The Spec");
    });
    expect(fetchTitle).toHaveBeenCalledWith("https://example.com/spec");
    await vi.waitFor(() =>
      expect(publishedEvents("task.link_updated")).toHaveLength(1),
    );
  });

  it("leaves titled links and failing pages alone", async () => {
    const s = await taskDetailScene();
    const task = await s.createTask();
    const fetchTitle = vi.fn(async () => {
      throw new Error("refused");
    });
    Object.assign(linkTitleAutofill, { enabled: true, fetchTitle });

    await s.as(s.member)(
      `/task-link/${task.id}`,
      json("POST", { url: "https://example.com/a", title: "Mine" }),
    );
    const untitled = await s.as(s.member)(
      `/task-link/${task.id}`,
      json("POST", { url: "https://example.com/b" }),
    );
    expect(untitled.status).toBe(200);
    expect(fetchTitle).toHaveBeenCalledTimes(1);
    expect(publishedEvents("task.link_updated")).toHaveLength(0);
  });
});
