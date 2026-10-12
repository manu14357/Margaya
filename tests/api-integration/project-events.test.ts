import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import {
  clearPublishedEvents,
  json,
  publishedEvents,
  recordEvents,
  settle,
} from "./helpers/intake";

recordEvents("project.created", "project.updated", "project.deleted");

describe("API integration: project events (B13 K28)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    clearPublishedEvents();
  });

  it("publishes created, updated (only what changed) and deleted", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(user);
    const { app } = createApp();

    const created = await app.request(
      "/api/project",
      json("POST", {
        name: "Web",
        workspaceId: workspace.id,
        icon: "Layout",
        slug: "web",
      }),
    );
    expect(created.status).toBe(200);
    const project = (await created.json()) as { id: string };

    const body = {
      name: "Website",
      icon: "Layout",
      slug: "web",
      description: "",
      isPublic: false,
    };
    const path = `/api/project/${project.id}?workspaceId=${workspace.id}`;
    expect((await app.request(path, json("PUT", body))).status).toBe(200);
    // The same values again change nothing and publish nothing.
    expect((await app.request(path, json("PUT", body))).status).toBe(200);
    expect((await app.request(path, { method: "DELETE" })).status).toBe(200);
    await settle();

    expect(publishedEvents("project.created").map((e) => e.data)).toEqual([
      expect.objectContaining({
        projectId: project.id,
        workspaceId: workspace.id,
        userId: user.id,
        name: "Web",
        slug: "web",
      }),
    ]);
    expect(publishedEvents("project.updated").map((e) => e.data)).toEqual([
      expect.objectContaining({
        projectId: project.id,
        userId: user.id,
        changed: ["name"],
      }),
    ]);
    expect(publishedEvents("project.deleted").map((e) => e.data)).toEqual([
      expect.objectContaining({
        projectId: project.id,
        workspaceId: workspace.id,
        userId: user.id,
        name: "Website",
        slug: "web",
      }),
    ]);
  });
});
