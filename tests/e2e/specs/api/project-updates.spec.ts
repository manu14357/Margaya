import { expect, test } from "../../fixtures";
import {
  createProject,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";

// Project status updates (#7): the opt-in feature, posting, drafting,
// comments, reactions, following, the weekly reminder and the roll-up.

type Update = {
  id: string;
  health: string;
  summary: string;
  commentCount: number;
};

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Project updates");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "posts, drafts, edits and deletes project updates",
  covers(
    "listProjectUpdates",
    "createProjectUpdate",
    "draftProjectUpdate",
    "getProjectUpdate",
    "updateProjectUpdate",
    "deleteProjectUpdate",
    "listLatestProjectUpdates",
  ),
  async () => {
    const owner = world.as("owner");
    const member = world.as("member");
    const base = `/api/project-update/project/${project.id}`;

    // Off until turned on.
    await expectStatus(await member.get(base), 403);
    await expectJson(
      await owner.patch(`/api/project/${project.id}/features`, {
        data: { updatesEnabled: true },
      }),
    );

    const draft = await expectJson<{
      aiDrafted: boolean;
      draft: { health: string; summary: string };
    }>(await member.post(`${base}/draft`, { data: { useAi: false } }));
    expect(draft.aiDrafted).toBe(false);
    expect(draft.draft.summary).toContain("% of tasks are complete");

    const update = await expectJson<Update>(
      await member.post(base, {
        data: { health: draft.draft.health, summary: draft.draft.summary },
      }),
    );
    const list = await expectJson<{ updates: Update[] }>(
      await member.get(base),
    );
    expect(list.updates.map((row) => row.id)).toContain(update.id);

    const edited = await expectJson<Update>(
      await member.patch(`/api/project-update/${update.id}`, {
        data: { health: "at_risk" },
      }),
    );
    expect(edited.health).toBe("at_risk");
    await expectJson(await member.get(`/api/project-update/${update.id}`));

    const latest = await expectJson<{ updates: { id: string }[] }>(
      await member.get(
        `/api/project-update/workspace/${world.workspace.id}/latest`,
      ),
    );
    expect(latest.updates.map((row) => row.id)).toContain(update.id);

    await expectJson(await owner.delete(`/api/project-update/${update.id}`));
    await expectStatus(
      await member.get(`/api/project-update/${update.id}`),
      404,
    );
  },
);

test(
  "comments, reactions, following and the reminder",
  covers(
    "createProjectUpdateComment",
    "deleteProjectUpdateComment",
    "addProjectUpdateReaction",
    "removeProjectUpdateReaction",
    "getProjectUpdateFollow",
    "setProjectUpdateFollow",
    "getProjectUpdateReminder",
    "setProjectUpdateReminder",
  ),
  async () => {
    const owner = world.as("owner");
    const member = world.as("member");
    const viewer = world.as("viewer");
    const base = `/api/project-update/project/${project.id}`;
    const update = await expectJson<Update>(
      await member.post(base, {
        data: { health: "on_track", summary: "All good." },
      }),
    );

    const comment = await expectJson<{ id: string }>(
      await owner.post(`/api/project-update/${update.id}/comment`, {
        data: { content: "Nice work" },
      }),
    );
    await expectJson(
      await owner.delete(`/api/project-update/comment/${comment.id}`),
    );

    await expectJson(
      await viewer.put(`/api/project-update/${update.id}/reaction/heart`),
    );
    expect(
      await expectJson(
        await viewer.delete(`/api/project-update/${update.id}/reaction/heart`),
      ),
    ).toEqual([]);

    expect(await expectJson(await viewer.get(`${base}/follow`))).toEqual({
      following: false,
      isLead: false,
    });
    expect(
      await expectJson(
        await viewer.put(`${base}/follow`, { data: { following: true } }),
      ),
    ).toEqual({ following: true, isLead: false });

    await expectStatus(
      await member.put(`${base}/reminder`, { data: { enabled: true } }),
      403,
    );
    await expectJson(
      await owner.put(`${base}/reminder`, {
        data: { enabled: true, weekday: 5 },
      }),
    );
    expect(
      await expectJson(await member.get(`${base}/reminder`)),
    ).toMatchObject({ enabled: true, weekday: 5 });
  },
);
