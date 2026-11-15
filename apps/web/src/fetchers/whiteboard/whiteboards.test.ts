import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import listTaskWhiteboards from "./list-task-whiteboards";
import { getWhiteboardContent } from "./whiteboard-content";
import {
  createWhiteboard,
  duplicateWhiteboard,
  listWhiteboards,
  lockWhiteboard,
  publishWhiteboard,
  unlockWhiteboard,
  unpublishWhiteboard,
} from "./whiteboards";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  duplicate: vi.fn(),
  lock: vi.fn(),
  unlock: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  content: vi.fn(),
  byTask: vi.fn(),
}));

vi.mock("@margaya/libs", () => ({
  client: {
    whiteboard: {
      $get: api.list,
      $post: api.create,
      "by-task": { ":taskId": { $get: api.byTask } },
      ":id": {
        $get: api.get,
        duplicate: { $post: api.duplicate },
        lock: { $post: api.lock, $delete: api.unlock },
        publication: { $post: api.publish, $delete: api.unpublish },
        content: { $get: api.content },
      },
    },
  },
}));

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe("whiteboard fetchers", () => {
  it("lists live boards without an empty search", async () => {
    api.list.mockResolvedValue(Response.json({ whiteboards: [] }));
    await expect(
      listWhiteboards("p1", { archived: false, q: "  " }),
    ).resolves.toEqual({ whiteboards: [] });
    expect(api.list).toHaveBeenCalledWith({
      query: { projectId: "p1", archived: "false" },
    });
  });

  it("sends the archived flag and a trimmed search", async () => {
    api.list.mockResolvedValue(Response.json({ whiteboards: [] }));
    await listWhiteboards("p1", { archived: true, q: " retro " });
    expect(api.list).toHaveBeenCalledWith({
      query: { projectId: "p1", archived: "true", q: "retro" },
    });
  });

  it("throws the API's message as an HttpError", async () => {
    api.list.mockResolvedValue(
      new Response("Whiteboards are off for this project", { status: 403 }),
    );
    const error = await listWhiteboards("p1", { archived: false, q: "" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(403);
    expect((error as HttpError).message).toBe(
      "Whiteboards are off for this project",
    );
  });

  it("creates a board with template elements", async () => {
    api.create.mockResolvedValue(Response.json({ id: "wb1" }, { status: 201 }));
    const elements = [{ id: "e1", type: "sticky" }];
    await expect(
      createWhiteboard({ projectId: "p1", title: "Retro", elements }),
    ).resolves.toEqual({ id: "wb1" });
    expect(api.create).toHaveBeenCalledWith({
      json: { projectId: "p1", title: "Retro", elements },
    });
  });

  it("names the copy it asks for", async () => {
    api.duplicate.mockResolvedValue(Response.json({ id: "wb2" }));
    await duplicateWhiteboard("wb1", "Retro (copy)");
    expect(api.duplicate).toHaveBeenCalledWith({
      param: { id: "wb1" },
      json: { title: "Retro (copy)" },
    });
  });

  it("locks with POST and unlocks with DELETE on the same route", async () => {
    api.lock.mockResolvedValue(Response.json({ id: "wb1", isLocked: true }));
    api.unlock.mockResolvedValue(Response.json({ id: "wb1", isLocked: false }));
    await lockWhiteboard("wb1");
    await unlockWhiteboard("wb1");
    expect(api.lock).toHaveBeenCalledWith({ param: { id: "wb1" } });
    expect(api.unlock).toHaveBeenCalledWith({ param: { id: "wb1" } });
  });

  it("publishes and revokes the public link", async () => {
    api.publish.mockResolvedValue(
      Response.json({ publicToken: "tok", publishedAt: "2026-11-14" }),
    );
    api.unpublish.mockResolvedValue(
      Response.json({ publicToken: null, publishedAt: null }),
    );
    await expect(publishWhiteboard("wb1")).resolves.toEqual({
      publicToken: "tok",
      publishedAt: "2026-11-14",
    });
    await expect(unpublishWhiteboard("wb1")).resolves.toEqual({
      publicToken: null,
      publishedAt: null,
    });
  });

  it("reads the stored content with an abort signal", async () => {
    api.content.mockResolvedValue(
      Response.json({ elements: [], settings: {}, contentVersion: 3 }),
    );
    const controller = new AbortController();
    await getWhiteboardContent("wb1", controller.signal);
    expect(api.content).toHaveBeenCalledWith(
      { param: { id: "wb1" } },
      { init: { signal: controller.signal } },
    );
  });

  it("lists the boards that hold a task's card", async () => {
    api.byTask.mockResolvedValue(Response.json({ whiteboards: [] }));
    await listTaskWhiteboards("t1");
    expect(api.byTask).toHaveBeenCalledWith({ param: { taskId: "t1" } });
  });
});
