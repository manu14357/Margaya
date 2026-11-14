import { beforeEach, describe, expect, it, vi } from "vitest";

// The audit entries the whiteboard events turn into. The database only
// answers the board title lookup, for events that don't carry the title.

const state = vi.hoisted(() => ({ titles: [] as unknown[][] }));

vi.mock("../../../apps/api/src/database", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => state.titles.shift() ?? [],
  };
  return { default: chain };
});

const { EVENT_ACTIONS } = await import(
  "../../../apps/api/src/audit-log/capture-events"
);

const ids = {
  whiteboardId: "wb1",
  projectId: "p1",
  workspaceId: "ws1",
  userId: "u1",
};

async function entries(event: string, data: Record<string, unknown>) {
  const map = EVENT_ACTIONS[event];
  if (!map) throw new Error(`No mapper for ${event}`);
  const result = await map({ ...ids, ...data });
  return Array.isArray(result) ? result : result ? [result] : [];
}

beforeEach(() => {
  state.titles = [];
});

describe("whiteboard audit entries", () => {
  it.each([
    ["whiteboard.created", {}, "whiteboard.created"],
    ["whiteboard.updated", { change: "locked" }, "whiteboard.locked"],
    ["whiteboard.updated", { change: "unlocked" }, "whiteboard.unlocked"],
    ["whiteboard.updated", { change: "archived" }, "whiteboard.archived"],
    ["whiteboard.updated", { change: "unarchived" }, "whiteboard.unarchived"],
    ["whiteboard.updated", { change: "published" }, "whiteboard.published"],
    ["whiteboard.updated", { change: "unpublished" }, "whiteboard.unpublished"],
    ["whiteboard.deleted", {}, "whiteboard.trashed"],
    ["whiteboard.restored", {}, "whiteboard.restored"],
    ["whiteboard.purged", {}, "whiteboard.purged"],
  ])("%s %j writes %s", async (event, data, action) => {
    expect(await entries(event, { ...data, title: "Retro" })).toEqual([
      {
        workspaceId: "ws1",
        action,
        target: { type: "whiteboard", id: "wb1", label: "Retro" },
        metadata: { projectId: "p1", title: "Retro" },
        actor: { userId: "u1" },
      },
    ]);
  });

  it("reads the new title of a rename and writes one entry per change", async () => {
    state.titles.push([{ title: "Sprint 13" }]);
    const result = await entries("whiteboard.updated", {
      change: "details",
      changed: ["title", "icon"],
    });
    expect(result.map((entry) => entry.action)).toEqual([
      "whiteboard.renamed",
      "whiteboard.icon_changed",
    ]);
    expect(result[0]).toMatchObject({
      target: { label: "Sprint 13" },
      metadata: { projectId: "p1", title: "Sprint 13" },
    });
  });

  it("labels an untitled board with no label and never records content", async () => {
    const [entry] = await entries("whiteboard.created", {
      title: "",
      contentText: "secret plans",
      elements: [{ id: "e1" }],
    });
    expect(entry?.target).toEqual({
      type: "whiteboard",
      id: "wb1",
      label: null,
    });
    expect(JSON.stringify(entry)).not.toContain("secret plans");
    expect(Object.keys(entry?.metadata ?? {})).toEqual(["projectId", "title"]);
  });

  it("writes nothing for content saves or events without ids", async () => {
    expect(EVENT_ACTIONS["whiteboard.content_saved"]).toBeUndefined();
    expect(await entries("whiteboard.created", { workspaceId: null })).toEqual(
      [],
    );
    expect(
      await entries("whiteboard.updated", { change: "unknown", title: "x" }),
    ).toEqual([]);
  });
});
