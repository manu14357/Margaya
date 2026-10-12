import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { intakeScene, json } from "./helpers/intake";

type LookupJson = {
  id: string;
  projectId: string;
  number: number;
  key: string;
};

describe("API integration: task lookup by readable key", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("resolves a key in any case for workspace members", async () => {
    const scene = await intakeScene();
    const task = await scene.createBoardTask({ number: 12 });

    for (const key of ["WEB-12", "web-12", "Web-12"]) {
      const response = await scene.as(scene.viewer)(
        `/task/by-key/${scene.workspace.id}/${key}`,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as LookupJson;
      expect(body).toEqual({
        id: task.id,
        projectId: scene.project.id,
        number: 12,
        key: "WEB-12",
      });
    }
  });

  it("answers 404 for unknown and malformed keys", async () => {
    const scene = await intakeScene();
    await scene.createBoardTask({ number: 3 });

    for (const key of ["WEB-4", "NOPE-3", "WEB", "12", "WEB-0", "W_B-3"]) {
      const response = await scene.as(scene.member)(
        `/task/by-key/${scene.workspace.id}/${key}`,
      );
      expect(response.status, key).toBe(404);
    }
  });

  it("keeps a key inside its own workspace", async () => {
    const scene = await intakeScene();
    await scene.createBoardTask({ number: 5 });
    const other = await createWorkspaceMember({ userName: "Olga" });
    await createProjectFixture({
      workspaceId: other.workspace.id,
      slug: "ops",
    });

    // The task's workspace, asked by someone outside it.
    const outsider = await scene.as(scene.outsider)(
      `/task/by-key/${scene.workspace.id}/WEB-5`,
    );
    expect(outsider.status).toBe(403);

    // The key, asked inside another workspace the caller belongs to.
    const elsewhere = await scene.as(other.user)(
      `/task/by-key/${other.workspace.id}/WEB-5`,
    );
    expect(elsewhere.status).toBe(404);
  });

  it("hides intake requests and drafts, and still finds archived tasks", async () => {
    const scene = await intakeScene();
    const request = await scene.submit(scene.viewer, { title: "Dark mode" });
    expect(request.task.key).toMatch(/^WEB-\d+$/);

    const pending = await scene.as(scene.admin)(
      `/task/by-key/${scene.workspace.id}/${request.task.key}`,
    );
    expect(pending.status).toBe(404);

    // Drafts have no number: the next key stays unknown after saving one.
    const draft = await scene.as(scene.member)(
      "/task-draft",
      json("POST", {
        workspaceId: scene.workspace.id,
        projectId: scene.project.id,
        title: "Half an idea",
      }),
    );
    expect(draft.status, await draft.clone().text()).toBe(200);
    const nextNumber = request.task.number + 1;
    const draftKey = await scene.as(scene.member)(
      `/task/by-key/${scene.workspace.id}/WEB-${nextNumber}`,
    );
    expect(draftKey.status).toBe(404);

    const archived = await scene.createBoardTask({ number: 77 });
    await db
      .update(schema.taskTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.taskTable.id, archived.id));
    const response = await scene.as(scene.member)(
      `/task/by-key/${scene.workspace.id}/WEB-77`,
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as LookupJson).id).toBe(archived.id);
  });
});
