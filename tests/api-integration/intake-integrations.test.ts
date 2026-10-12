import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  initializeEventSubscriptions,
  registerPlugin,
} from "../../apps/api/src/plugins/registry";
import type { IntegrationPlugin } from "../../apps/api/src/plugins/types";
import { resetTestDatabase } from "./helpers/database";
import { intakeScene, json, settle } from "./helpers/intake";

// B7 K8: an unreviewed request must never reach chat, webhooks or issue sync.
// A probe plugin records what the registry fans out for its integration.
const delivered: Array<{ hook: string; taskId: string }> = [];
const record =
  (hook: string) =>
  async ({ taskId }: { taskId: string }) => {
    delivered.push({ hook, taskId });
  };

beforeAll(() => {
  registerPlugin({
    type: "k8-probe",
    name: "K8 probe",
    onTaskCreated: record("created"),
    onTaskStatusChanged: record("statusChanged"),
    onTaskPriorityChanged: record("priorityChanged"),
    onTaskTitleChanged: record("titleChanged"),
    onTaskDescriptionChanged: record("descriptionChanged"),
    onTaskCommentCreated: record("commentCreated"),
    onTaskDeleted: record("deleted"),
  } as unknown as IntegrationPlugin);
  initializeEventSubscriptions();
});

async function sceneWithProbe() {
  const scene = await intakeScene();
  await db.insert(schema.integrationTable).values({
    projectId: scene.project.id,
    type: "k8-probe",
    config: "{}",
    isActive: true,
  });
  return scene;
}

function hooksFor(taskId: string) {
  return delivered
    .filter((entry) => entry.taskId === taskId)
    .map((entry) => entry.hook);
}

describe("API integration: integrations and tasks in intake", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    delivered.length = 0;
  });

  it("sends nothing while a request waits, then announces it on accept", async () => {
    const { admin, member, as, submit, action } = await sceneWithProbe();
    const item = await submit(member);
    const taskId = item.task.id;

    const edited = await as(admin)(
      `/intake/item/${item.id}`,
      json("PATCH", { title: "Dark mode, please", priority: "high" }),
    );
    expect(edited.status, await edited.clone().text()).toBe(200);
    const commented = await as(admin)(
      `/comment/${taskId}`,
      json("POST", { content: "Looking into it" }),
    );
    expect(commented.status).toBe(200);
    await settle(400);
    expect(hooksFor(taskId)).toEqual([]);

    const accepted = await action(admin, item.id, "accept", {
      status: "to-do",
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    await settle(400);
    expect(hooksFor(taskId)).toEqual(["created"]);

    // On the board, edits reach integrations as usual.
    const renamed = await as(admin)(
      `/task/title/${taskId}`,
      json("PUT", { title: "Dark mode" }),
    );
    expect(renamed.status).toBe(200);
    await settle(400);
    expect(hooksFor(taskId)).toEqual(["created", "titleChanged"]);
  });

  it("announces no deletion of a request that never reached the board", async () => {
    const { admin, member, as, submit, createBoardTask } =
      await sceneWithProbe();
    const item = await submit(member);
    const boardTask = await createBoardTask();

    const removed = await as(admin)(`/intake/item/${item.id}`, {
      method: "DELETE",
    });
    expect(removed.status, await removed.clone().text()).toBe(200);
    const removedBoardTask = await as(admin)(`/task/${boardTask.id}`, {
      method: "DELETE",
    });
    expect(removedBoardTask.status).toBe(200);
    await settle(400);

    expect(hooksFor(item.task.id)).toEqual([]);
    expect(hooksFor(boardTask.id)).toEqual(["deleted"]);
  });
});
