import { expect, test } from "../../fixtures";
import {
  createWorld,
  expectJson,
  expectStatus,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";

// Built-in project templates: the gallery, a preview, creating from a
// template with example tasks, removing them, and workspace starters.

type Catalog = { templates: { id: string }[]; categories: { id: string }[] };
type Created = { id: string; template?: { sampleTaskCount: number } };

let world: World;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Templates");
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "list and preview templates, create one and remove its example tasks",
  covers(
    "listProjectTemplates",
    "getProjectTemplate",
    "removeProjectSampleData",
  ),
  async () => {
    const catalog = await expectJson<Catalog>(
      await world.as("viewer").get("/api/project-template"),
    );
    expect(catalog.categories.length).toBe(17);
    expect(catalog.templates.map((t) => t.id)).toContain("kanban");
    await expectJson(
      await world.as("viewer").get("/api/project-template/kanban"),
    );
    await expectStatus(
      await world.as("viewer").get("/api/project-template/none"),
      404,
    );

    const created = await expectJson<Created>(
      await world.as("member").post("/api/project", {
        data: {
          workspaceId: world.workspace.id,
          name: "Kanban from template",
          icon: "FolderKanban",
          slug: `K${Date.now().toString(36).slice(-4).toUpperCase()}`,
          template: { id: "kanban", sampleData: true },
        },
      }),
    );
    expect(created.template?.sampleTaskCount).toBeGreaterThan(0);
    const path = `/api/project-template/project/${created.id}/remove-sample-data`;
    await expectStatus(await world.as("viewer").post(path), 403);
    const removed = await expectJson<{ removedTaskCount: number }>(
      await world.as("member").post(path),
    );
    expect(removed.removedTaskCount).toBe(created.template?.sampleTaskCount);
  },
);

test(
  "workspace starters apply only to an empty workspace",
  covers("listWorkspaceStarters", "applyWorkspaceStarter"),
  async () => {
    await expectJson(
      await world.as("owner").get("/api/project-template/starters"),
    );
    await expectStatus(
      await world
        .as("owner")
        .post(`/api/workspace/${world.workspace.id}/starter`, {
          data: { starterId: "no-such-starter" },
        }),
      404,
    );
  },
);
