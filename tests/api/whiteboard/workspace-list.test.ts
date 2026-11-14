import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

import { workspaceBoardsResponse } from "../../../apps/api/src/whiteboard/controllers/list-whiteboards";
import { listWorkspaceWhiteboardsRoute } from "../../../apps/api/src/whiteboard/routes";
import {
  listWorkspaceWhiteboardsQuery,
  workspaceWhiteboardsParam,
} from "../../../apps/api/src/whiteboard/schema";
import type { Reader } from "../../../apps/api/src/whiteboard/shared";

// The people lookup is the only read: select().from().where() resolves to
// the users.
function peopleReader(users: { id: string; name: string; image: null }[]) {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve(users),
  };
  return { select: () => chain } as unknown as Reader;
}

const NOW = new Date("2026-11-01T10:00:00Z");

function boardRow(id: string, projectId: string, extra = {}) {
  return {
    id,
    workspaceId: "w1",
    projectId,
    title: `Board ${id}`,
    icon: null,
    isLocked: false,
    lockedById: null,
    lockedAt: null,
    archivedAt: null,
    deletedAt: null,
    deletedById: null,
    publicToken: `token-${id}`,
    publishedAt: NOW,
    publishedById: "u1",
    contentText: "",
    elementCount: 3,
    contentVersion: 2,
    createdById: "u1",
    updatedById: "u1",
    createdAt: NOW,
    updatedAt: NOW,
    projectName: `Project ${projectId}`,
    projectSlug: projectId.toUpperCase(),
    projectIcon: "Layout",
    ...extra,
  };
}

const manager = {
  userId: "u9",
  canRead: true,
  canCreate: true,
  canUpdate: true,
  isManager: true,
};

const reader = peopleReader([{ id: "u1", name: "Ada", image: null }]);

describe("workspaceBoardsResponse", () => {
  it("returns each board with its project and its people", async () => {
    const { whiteboards } = await workspaceBoardsResponse(
      [boardRow("b1", "p1"), boardRow("b2", "p2")],
      { caller: manager, withoutUpdate: [], withoutDelete: [] },
      reader,
    );
    expect(whiteboards.map((board) => board.id)).toEqual(["b1", "b2"]);
    expect(whiteboards[0]).toMatchObject({
      projectId: "p1",
      project: { id: "p1", name: "Project p1", slug: "P1", icon: "Layout" },
      createdBy: { id: "u1", name: "Ada" },
      publicToken: "token-b1",
    });
    // Internal columns stay out of the response.
    expect(whiteboards[0]).not.toHaveProperty("contentText");
    expect(whiteboards[0]).not.toHaveProperty("projectName");
  });

  it("hides the public link where a project role withholds managing", async () => {
    const { whiteboards } = await workspaceBoardsResponse(
      [boardRow("b1", "p1"), boardRow("b2", "p2")],
      { caller: manager, withoutUpdate: [], withoutDelete: ["p2"] },
      reader,
    );
    expect(whiteboards.map((board) => board.publicToken)).toEqual([
      "token-b1",
      null,
    ]);
    // Still published: the badge doesn't need the token.
    expect(whiteboards[1]?.publishedAt).toEqual(NOW);
  });

  it("lets a creator see their own link unless the project withholds update", async () => {
    const creator = { ...manager, userId: "u1", isManager: false };
    const { whiteboards } = await workspaceBoardsResponse(
      [boardRow("b1", "p1"), boardRow("b2", "p2")],
      { caller: creator, withoutUpdate: ["p2"], withoutDelete: [] },
      reader,
    );
    expect(whiteboards.map((board) => board.publicToken)).toEqual([
      "token-b1",
      null,
    ]);
  });
});

describe("listWorkspaceWhiteboards request", () => {
  it("is a literal workspace path guarded by whiteboard:read", () => {
    expect(listWorkspaceWhiteboardsRoute.operationId).toBe(
      "listWorkspaceWhiteboards",
    );
    expect(listWorkspaceWhiteboardsRoute.path).toBe("/workspace/{workspaceId}");
    expect(listWorkspaceWhiteboardsRoute.middleware).toHaveLength(2);
    expect(listWorkspaceWhiteboardsRoute.description).toContain(
      "whiteboard:read",
    );
  });

  it("takes archived and q, and no project", () => {
    expect(
      listWorkspaceWhiteboardsQuery.safeParse({ archived: "true", q: "retro" })
        .success,
    ).toBe(true);
    expect(
      listWorkspaceWhiteboardsQuery.safeParse({ archived: "yes" }).success,
    ).toBe(false);
    expect(
      listWorkspaceWhiteboardsQuery.safeParse({ q: "x".repeat(201) }).success,
    ).toBe(false);
    expect(listWorkspaceWhiteboardsQuery.parse({ projectId: "p1" })).toEqual(
      {},
    );
    expect(
      workspaceWhiteboardsParam.safeParse({ workspaceId: "" }).success,
    ).toBe(false);
  });
});
