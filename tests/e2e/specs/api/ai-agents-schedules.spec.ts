import type { APIRequestContext, APIResponse } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  addMember,
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  signUpUser,
  type Task,
  type TestUser,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";

// Agent templates, schedules, the intake trigger and the run conversation
// (reply, follow-up). AI is off on the e2e instance, but templates, schedule
// CRUD and the intake trigger are configuration and work without a model;
// the scheduler and intake events never start a run while AI is off, so
// reply and follow-up are checked through their guards and unknown ids.
// Everything happens in this file's own workspace: two custom roles there
// separate ai:manage from ai:use and intake:read.

type Agent = {
  id: string;
  userId: string;
  name: string;
  role: string | null;
  projectIds: string[] | null;
  intakeTrigger: {
    enabled: boolean;
    prompt: string | null;
    runsAs: { id: string; name: string } | null;
  } | null;
};

type Template = {
  id: string;
  name: string;
  instructions: string;
  role: "member" | "viewer";
  modelTier: "fast" | "balanced" | "deep";
  suggestedTriggers: string[];
  suggestedSchedule: { cron: string; prompt: string } | null;
};

type Schedule = {
  id: string;
  agentId: string;
  project: { id: string; name: string; slug: string } | null;
  task: { id: string; key: string; title: string } | null;
  cron: string;
  timezone: string;
  prompt: string;
  enabled: boolean;
  runsAs: { id: string; name: string } | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const UNKNOWN = "e2e-unknown-id";

let world: World;
let outsider: TestUser;
/** A workspace member whose custom role has ai:manage but not ai:use. */
let aiManager: TestUser;
/** A custom role that reads projects and tasks but not intake requests. */
let noIntakeRole: string;
let managerRole: string;

test.describe.configure({ mode: "serial" });

async function createRole(
  owner: APIRequestContext,
  workspaceId: string,
  prefix: string,
  permission: Record<string, string[]>,
) {
  const role = `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await expectJson(
    await owner.post("/api/auth/organization/create-role", {
      data: { organizationId: workspaceId, role, permission },
    }),
  );
  return role;
}

test.beforeAll(async () => {
  world = await createWorld("Agent schedules");
  outsider = await signUpUser("Agent schedules outsider");
  aiManager = await signUpUser("Agent schedules manager");
  const owner = world.as("owner");
  const workspaceId = world.workspace.id;
  noIntakeRole = await createRole(owner, workspaceId, "nointake", {
    project: ["read"],
    task: ["read"],
  });
  managerRole = await createRole(owner, workspaceId, "aimanager", {
    project: ["read"],
    task: ["read"],
    intake: ["read"],
    ai: ["manage"],
  });
  await addMember(owner, workspaceId, aiManager, "member");
  const { members } = await expectJson<{
    members: { id: string; userId: string }[];
  }>(
    await owner.get("/api/auth/organization/list-members", {
      params: { organizationId: workspaceId },
    }),
  );
  const row = members.find((member) => member.userId === aiManager.id);
  expect(row).toBeTruthy();
  await expectJson(
    await owner.post("/api/auth/organization/update-member-role", {
      data: {
        memberId: row?.id,
        role: managerRole,
        organizationId: workspaceId,
      },
    }),
  );
});

test.afterAll(async () => {
  await outsider?.ctx.dispose();
  await aiManager?.ctx.dispose();
  await world?.dispose();
});

async function createAgent(data: Record<string, unknown>) {
  return expectJson<Agent>(
    await world.as("owner").post("/api/ai/agents", {
      data: { workspaceId: world.workspace.id, ...data },
    }),
  );
}

async function deleteAgent(agentId: string) {
  await world
    .as("owner")
    .delete(`/api/ai/agents/${agentId}?workspaceId=${world.workspace.id}`);
}

/** A 400 with a stable error code in its JSON body. */
async function expectCode(response: APIResponse, status: number, code: string) {
  const text = await expectStatus(response, status);
  expect(JSON.parse(text)).toMatchObject({ code });
  return text;
}

test(
  "agent templates: the ready-made agents, for ai:manage only",
  covers("listAgentTemplates"),
  async () => {
    const url = `/api/ai/agents/templates?workspaceId=${world.workspace.id}`;
    const templates = await expectJson<Template[]>(
      await world.as("admin").get(url),
    );
    expect(templates.map((template) => template.id)).toEqual([
      "triage",
      "standup",
      "specWriter",
      "deliveryRisk",
      "feedback",
    ]);
    for (const template of templates) {
      expect(template.name).toBeTruthy();
      expect(template.instructions.length).toBeGreaterThan(20);
      expect(["member", "viewer"]).toContain(template.role);
      expect(["fast", "balanced", "deep"]).toContain(template.modelTier);
      expect(template.suggestedTriggers.length).toBeGreaterThan(0);
    }
    expect(templates[0]).toMatchObject({
      id: "triage",
      role: "member",
      modelTier: "fast",
      suggestedTriggers: ["assign", "automation"],
      suggestedSchedule: null,
    });
    expect(templates[1]?.suggestedSchedule).toMatchObject({
      cron: "0 9 * * 1-5",
    });
    expect(await expectJson(await aiManager.ctx.get(url))).toEqual(templates);

    // ai:manage: members and viewers are refused, as are strangers.
    await expectStatus(await world.as("member").get(url), 403);
    await expectStatus(await world.as("viewer").get(url), 403);
    await expectStatus(await outsider.ctx.get(url), 403);
    await expectStatus(await world.as("anonymous").get(url), 401);
    await expectStatus(
      await world.as("owner").get("/api/ai/agents/templates"),
      [400, 403],
    );
  },
);

test(
  "agent schedules: create, list, update, turn off and on, delete",
  covers(
    "listAgentSchedules",
    "createAgentSchedule",
    "updateAgentSchedule",
    "deleteAgentSchedule",
  ),
  async () => {
    const owner = world.as("owner");
    const workspaceId = world.workspace.id;
    const project = await createProject(owner, workspaceId);
    const other = await createProject(owner, workspaceId);
    const offProject = await createProject(owner, workspaceId);
    const task = await createTask(owner, project.id, {
      title: "Weekly report",
    });
    const otherTask = await createTask(owner, other.id);
    await expectJson(
      await owner.patch(`/api/project/${offProject.id}/features`, {
        data: { aiEnabled: false },
      }),
    );
    const agent = await createAgent({ name: "Standup Bot" });
    // An agent kept to one project.
    const scoped = await createAgent({
      name: "Scoped Bot",
      projectIds: [project.id],
    });
    const listUrl = (agentId: string) =>
      `/api/ai/agents/${agentId}/schedules?workspaceId=${workspaceId}`;
    const createUrl = `/api/ai/agents/${agent.id}/schedules`;
    const itemUrl = (id: string) =>
      `/api/ai/agents/${agent.id}/schedules/${id}`;
    const base = {
      workspaceId,
      projectId: project.id,
      cron: "0 9 * * 1-5",
      timezone: "Europe/Berlin",
      prompt: "Write today's standup summary.",
    };
    const created: string[] = [];

    try {
      expect(await expectJson(await owner.get(listUrl(agent.id)))).toEqual([]);

      // Authorization: ai:manage, workspace members only.
      await expectStatus(await world.as("member").get(listUrl(agent.id)), 403);
      await expectStatus(await world.as("viewer").get(listUrl(agent.id)), 403);
      await expectStatus(await outsider.ctx.get(listUrl(agent.id)), 403);
      await expectStatus(
        await world.as("anonymous").get(listUrl(agent.id)),
        401,
      );
      expect(
        await expectStatus(await owner.get(listUrl(UNKNOWN)), 404),
      ).toContain("Agent not found");
      await expectStatus(
        await world.as("member").post(createUrl, { data: base }),
        403,
      );
      await expectStatus(
        await outsider.ctx.post(createUrl, { data: base }),
        403,
      );
      // The runs act for whoever saves the schedule, so ai:manage alone is
      // not enough: they need ai:use too.
      expect(
        await expectStatus(
          await aiManager.ctx.post(createUrl, { data: base }),
          403,
        ),
      ).toContain("Scheduled runs act for you, so you need ai:use");
      expect(
        await expectStatus(
          await owner.post(`/api/ai/agents/${UNKNOWN}/schedules`, {
            data: base,
          }),
          404,
        ),
      ).toContain("Agent not found");

      // Validation: body, cron, time zone and target.
      await expectStatus(
        await owner.post(createUrl, { data: { ...base, extra: true } }),
        400,
      );
      await expectStatus(
        await owner.post(createUrl, { data: { ...base, prompt: "  " } }),
        400,
      );
      await expectCode(
        await owner.post(createUrl, {
          data: { ...base, cron: "*/5 * * * *" },
        }),
        400,
        "CRON_TOO_FREQUENT",
      );
      await expectCode(
        await owner.post(createUrl, {
          data: { ...base, cron: "0 9 * * 1-5 *" },
        }),
        400,
        "CRON_INVALID",
      );
      await expectCode(
        await owner.post(createUrl, {
          data: { ...base, cron: "61 25 * * *" },
        }),
        400,
        "CRON_INVALID",
      );
      await expectCode(
        await owner.post(createUrl, {
          data: { ...base, timezone: "Mars/Olympus_Mons" },
        }),
        400,
        "TIMEZONE_INVALID",
      );
      expect(
        await expectStatus(
          await owner.post(createUrl, {
            data: { ...base, projectId: UNKNOWN },
          }),
          400,
        ),
      ).toContain("projectId: project not found");
      expect(
        await expectStatus(
          await owner.post(createUrl, {
            data: { ...base, projectId: offProject.id },
          }),
          400,
        ),
      ).toContain("projectId: AI is turned off for this project");
      expect(
        await expectStatus(
          await owner.post(createUrl, {
            data: { ...base, taskId: otherTask.id },
          }),
          400,
        ),
      ).toContain("taskId: not a task of this project");
      await expectCode(
        await owner.post(`/api/ai/agents/${scoped.id}/schedules`, {
          data: { ...base, projectId: other.id },
        }),
        400,
        "OUTSIDE_AGENT_PROJECTS",
      );
      expect(await expectJson(await owner.get(listUrl(agent.id)))).toEqual([]);

      // A task schedule, saved by the owner.
      const before = Date.now();
      const onTask = await expectJson<Schedule>(
        await owner.post(createUrl, {
          data: {
            ...base,
            cron: "  0   9 * *  1-5 ",
            taskId: task.id,
            prompt: "  Write today's standup summary.  ",
          },
        }),
      );
      created.push(onTask.id);
      expect(onTask).toMatchObject({
        agentId: agent.id,
        project: { id: project.id, name: project.name, slug: project.slug },
        task: {
          id: task.id,
          key: `${project.slug.toUpperCase()}-${task.number}`,
          title: "Weekly report",
        },
        cron: "0 9 * * 1-5",
        timezone: "Europe/Berlin",
        prompt: "Write today's standup summary.",
        enabled: true,
        runsAs: { id: world.users.owner.id, name: world.users.owner.name },
        lastRunAt: null,
      });
      expect(Date.parse(onTask.nextRunAt ?? "")).toBeGreaterThan(before);

      // A project-level schedule, created off; its scoped twin is fine
      // inside the agent's project.
      const projectLevel = await expectJson<Schedule>(
        await world.as("admin").post(createUrl, {
          data: {
            ...base,
            cron: "30 16 * * 5",
            timezone: "America/New_York",
            enabled: false,
          },
        }),
      );
      created.push(projectLevel.id);
      expect(projectLevel).toMatchObject({
        task: null,
        enabled: false,
        nextRunAt: null,
        runsAs: { id: world.users.admin.id, name: world.users.admin.name },
      });
      const scopedSchedule = await expectJson<Schedule>(
        await owner.post(`/api/ai/agents/${scoped.id}/schedules`, {
          data: base,
        }),
      );
      expect(scopedSchedule.project?.id).toBe(project.id);

      const listed = await expectJson<Schedule[]>(
        await world.as("admin").get(listUrl(agent.id)),
      );
      expect(listed.map((schedule) => schedule.id)).toEqual([
        onTask.id,
        projectLevel.id,
      ]);
      expect(
        await expectJson(await aiManager.ctx.get(listUrl(agent.id))),
      ).toEqual(listed);
      // Each agent lists only its own.
      expect(
        (await expectJson<Schedule[]>(await owner.get(listUrl(scoped.id)))).map(
          (schedule) => schedule.id,
        ),
      ).toEqual([scopedSchedule.id]);

      // Update: authorization and validation first.
      const patch = (data: Record<string, unknown>) => ({
        data: { workspaceId, ...data },
      });
      await expectStatus(
        await world.as("member").patch(itemUrl(onTask.id), patch({})),
        403,
      );
      expect(
        await expectStatus(
          await aiManager.ctx.patch(
            itemUrl(onTask.id),
            patch({ prompt: "Mine now" }),
          ),
          403,
        ),
      ).toContain("you need ai:use");
      expect(
        await expectStatus(
          await owner.patch(itemUrl(UNKNOWN), patch({ prompt: "x" })),
          404,
        ),
      ).toContain("Schedule not found");
      // Another agent's schedule is not this agent's.
      await expectStatus(
        await owner.patch(itemUrl(scopedSchedule.id), patch({ prompt: "x" })),
        404,
      );
      await expectCode(
        await owner.patch(itemUrl(onTask.id), patch({ cron: "*/10 * * * *" })),
        400,
        "CRON_TOO_FREQUENT",
      );
      await expectStatus(
        await owner.patch(itemUrl(onTask.id), patch({ foo: 1 })),
        400,
      );

      // The admin saves it: new prompt and time, and the runs act for them.
      const updated = await expectJson<Schedule>(
        await world.as("admin").patch(
          itemUrl(onTask.id),
          patch({
            cron: "0 8 * * 1",
            timezone: "Asia/Tokyo",
            prompt: "Report the week's risks.",
          }),
        ),
      );
      expect(updated).toMatchObject({
        id: onTask.id,
        cron: "0 8 * * 1",
        timezone: "Asia/Tokyo",
        prompt: "Report the week's risks.",
        task: { id: task.id },
        enabled: true,
        runsAs: { id: world.users.admin.id, name: world.users.admin.name },
      });
      expect(updated.nextRunAt).not.toBeNull();
      expect(updated.nextRunAt).not.toBe(onTask.nextRunAt);

      // Off and on again (reverse state): off clears the next run.
      const off = await expectJson<Schedule>(
        await owner.patch(itemUrl(onTask.id), patch({ enabled: false })),
      );
      expect(off).toMatchObject({
        enabled: false,
        nextRunAt: null,
        runsAs: { id: world.users.owner.id },
        prompt: "Report the week's risks.",
      });
      const on = await expectJson<Schedule>(
        await owner.patch(itemUrl(onTask.id), patch({ enabled: true })),
      );
      expect(on.enabled).toBe(true);
      expect(Date.parse(on.nextRunAt ?? "")).toBeGreaterThan(before);

      // A task-level schedule becomes project-level; moving project drops the
      // task, and the agent's project list still applies.
      expect(
        (
          await expectJson<Schedule>(
            await owner.patch(itemUrl(onTask.id), patch({ taskId: null })),
          )
        ).task,
      ).toBeNull();
      await expectStatus(
        await owner.patch(
          itemUrl(onTask.id),
          patch({ projectId: offProject.id }),
        ),
        400,
      );
      const moved = await expectJson<Schedule>(
        await owner.patch(
          itemUrl(projectLevel.id),
          patch({ projectId: other.id, enabled: true }),
        ),
      );
      expect(moved).toMatchObject({
        project: { id: other.id, slug: other.slug },
        task: null,
        enabled: true,
        timezone: "America/New_York",
      });
      expect(moved.nextRunAt).not.toBeNull();
      await expectCode(
        await owner.patch(
          `/api/ai/agents/${scoped.id}/schedules/${scopedSchedule.id}`,
          patch({ projectId: other.id }),
        ),
        400,
        "OUTSIDE_AGENT_PROJECTS",
      );

      // Delete: ai:manage (not ai:use), each schedule once.
      const deleteUrl = (agentId: string, id: string) =>
        `/api/ai/agents/${agentId}/schedules/${id}?workspaceId=${workspaceId}`;
      await expectStatus(
        await world.as("member").delete(deleteUrl(agent.id, onTask.id)),
        403,
      );
      await expectStatus(
        await outsider.ctx.delete(deleteUrl(agent.id, onTask.id)),
        403,
      );
      await expectStatus(
        await owner.delete(deleteUrl(agent.id, scopedSchedule.id)),
        404,
      );
      expect(
        await expectJson(await owner.delete(deleteUrl(agent.id, onTask.id))),
      ).toEqual({ id: onTask.id });
      expect(
        await expectJson(
          await aiManager.ctx.delete(deleteUrl(agent.id, projectLevel.id)),
        ),
      ).toEqual({ id: projectLevel.id });
      expect(
        await expectJson(
          await owner.delete(deleteUrl(scoped.id, scopedSchedule.id)),
        ),
      ).toEqual({ id: scopedSchedule.id });
      created.length = 0;
      expect(
        await expectStatus(
          await owner.delete(deleteUrl(agent.id, onTask.id)),
          404,
        ),
      ).toContain("Schedule not found");
      expect(await expectJson(await owner.get(listUrl(agent.id)))).toEqual([]);
      expect(await expectJson(await owner.get(listUrl(scoped.id)))).toEqual([]);
    } finally {
      for (const id of created) {
        await owner.delete(
          `/api/ai/agents/${agent.id}/schedules/${id}?workspaceId=${workspaceId}`,
        );
      }
      await deleteAgent(agent.id);
      await deleteAgent(scoped.id);
      for (const p of [project, other, offProject]) {
        await owner.delete(`/api/project/${p.id}`);
      }
    }
  },
);

test(
  "a template's suggested schedule is a valid schedule",
  covers("listAgentTemplates", "createAgentSchedule", "deleteAgentSchedule"),
  async () => {
    const owner = world.as("owner");
    const workspaceId = world.workspace.id;
    const templates = await expectJson<Template[]>(
      await owner.get(`/api/ai/agents/templates?workspaceId=${workspaceId}`),
    );
    const project = await createProject(owner, workspaceId);
    const withSchedule = templates.filter(
      (template) => template.suggestedSchedule,
    );
    expect(withSchedule.map((template) => template.id)).toEqual([
      "standup",
      "deliveryRisk",
      "feedback",
    ]);
    const agents: Agent[] = [];
    try {
      for (const template of withSchedule) {
        const agent = await createAgent({
          name: template.name,
          instructions: template.instructions,
          role: template.role,
          modelTier: template.modelTier,
        });
        agents.push(agent);
        const suggested = template.suggestedSchedule as {
          cron: string;
          prompt: string;
        };
        const schedule = await expectJson<Schedule>(
          await owner.post(`/api/ai/agents/${agent.id}/schedules`, {
            data: {
              workspaceId,
              projectId: project.id,
              cron: suggested.cron,
              timezone: "UTC",
              prompt: suggested.prompt,
            },
          }),
        );
        expect(schedule).toMatchObject({
          cron: suggested.cron,
          prompt: suggested.prompt,
          enabled: true,
        });
        expect(schedule.nextRunAt).not.toBeNull();
        expect(
          await expectJson(
            await owner.delete(
              `/api/ai/agents/${agent.id}/schedules/${schedule.id}?workspaceId=${workspaceId}`,
            ),
          ),
        ).toEqual({ id: schedule.id });
      }
    } finally {
      for (const agent of agents) await deleteAgent(agent.id);
      await owner.delete(`/api/project/${project.id}`);
    }
  },
);

test(
  "intake trigger: turn on and off, prompt, rights of the person and the agent",
  covers("setAgentIntakeTrigger"),
  async () => {
    const owner = world.as("owner");
    const workspaceId = world.workspace.id;
    const agent = await createAgent({ name: "Intake Bot" });
    const blind = await createAgent({ name: "Blind Bot", role: noIntakeRole });
    const url = (agentId: string) => `/api/ai/agents/${agentId}/intake-trigger`;
    const body = (data: Record<string, unknown>) => ({
      data: { workspaceId, ...data },
    });
    try {
      expect(agent.intakeTrigger).toEqual({
        enabled: false,
        prompt: null,
        runsAs: null,
      });
      expect(blind.role).toBe(noIntakeRole);

      // ai:manage to change it; workspace members only.
      await expectStatus(
        await world.as("member").patch(url(agent.id), body({ enabled: true })),
        403,
      );
      await expectStatus(
        await world.as("viewer").patch(url(agent.id), body({ enabled: true })),
        403,
      );
      await expectStatus(
        await outsider.ctx.patch(url(agent.id), body({ enabled: true })),
        403,
      );
      await expectStatus(
        await world
          .as("anonymous")
          .patch(url(agent.id), body({ enabled: true })),
        401,
      );
      expect(
        await expectStatus(
          await owner.patch(url(UNKNOWN), body({ enabled: true })),
          404,
        ),
      ).toContain("Agent not found");
      await expectStatus(await owner.patch(url(agent.id), body({})), 400);
      await expectStatus(
        await owner.patch(url(agent.id), body({ enabled: "yes" })),
        400,
      );
      await expectStatus(
        await owner.patch(url(agent.id), body({ enabled: true, extra: 1 })),
        400,
      );

      // Turning it on acts for you: ai:manage without ai:use is refused.
      expect(
        await expectStatus(
          await aiManager.ctx.patch(url(agent.id), body({ enabled: true })),
          403,
        ),
      ).toContain("you need ai:use and intake:read");

      // The agent's role must read intake requests.
      const blindText = await expectCode(
        await owner.patch(url(blind.id), body({ enabled: true })),
        400,
        "AGENT_CANT_READ_INTAKE",
      );
      expect(blindText).toContain(
        "this agent's role can't read intake requests",
      );

      // On, with the built-in triage request.
      const on = await expectJson<Agent>(
        await world.as("admin").patch(url(agent.id), body({ enabled: true })),
      );
      expect(on).toMatchObject({
        id: agent.id,
        intakeTrigger: {
          enabled: true,
          prompt: null,
          runsAs: { id: world.users.admin.id, name: world.users.admin.name },
        },
      });

      // A custom prompt (trimmed); the owner turning it on takes over.
      const custom = await expectJson<Agent>(
        await owner.patch(
          url(agent.id),
          body({
            enabled: true,
            prompt: "  Label the request and set a priority.  ",
          }),
        ),
      );
      expect(custom.intakeTrigger).toEqual({
        enabled: true,
        prompt: "Label the request and set a priority.",
        runsAs: { id: world.users.owner.id, name: world.users.owner.name },
      });

      // Managers see the trigger in the agent list, members never do.
      expect(
        await expectJson<Agent[]>(
          await world
            .as("admin")
            .get(`/api/ai/agents?workspaceId=${workspaceId}`),
        ),
      ).toContainEqual(
        expect.objectContaining({
          id: agent.id,
          intakeTrigger: expect.objectContaining({ enabled: true }),
        }),
      );
      const forMember = await expectJson<Agent[]>(
        await world
          .as("member")
          .get(`/api/ai/agents?workspaceId=${workspaceId}`),
      );
      expect(forMember.find((entry) => entry.id === agent.id)).toMatchObject({
        intakeTrigger: null,
      });

      // Off needs only ai:manage; an omitted prompt is kept.
      const off = await expectJson<Agent>(
        await aiManager.ctx.patch(url(agent.id), body({ enabled: false })),
      );
      expect(off.intakeTrigger).toEqual({
        enabled: false,
        prompt: "Label the request and set a priority.",
        runsAs: { id: world.users.owner.id, name: world.users.owner.name },
      });
      // A blank prompt goes back to triage; off is allowed for any agent.
      const cleared = await expectJson<Agent>(
        await owner.patch(
          url(agent.id),
          body({ enabled: false, prompt: "  " }),
        ),
      );
      expect(cleared.intakeTrigger).toMatchObject({
        enabled: false,
        prompt: null,
      });
      expect(
        (
          await expectJson<Agent>(
            await owner.patch(url(blind.id), body({ enabled: false })),
          )
        ).intakeTrigger,
      ).toEqual({ enabled: false, prompt: null, runsAs: null });

      // On again with a null prompt, then off (reverse state).
      expect(
        (
          await expectJson<Agent>(
            await owner.patch(
              url(agent.id),
              body({ enabled: true, prompt: null }),
            ),
          )
        ).intakeTrigger,
      ).toMatchObject({ enabled: true, prompt: null });
      expect(
        (
          await expectJson<Agent>(
            await owner.patch(url(agent.id), body({ enabled: false })),
          )
        ).intakeTrigger?.enabled,
      ).toBe(false);
    } finally {
      await deleteAgent(agent.id);
      await deleteAgent(blind.id);
    }
  },
);

test(
  "reply and follow-up: guards and unknown runs while AI is off",
  covers("replyToAgentRun", "followUpAgentRun"),
  async () => {
    const owner = world.as("owner");
    const workspaceId = world.workspace.id;
    const project = await createProject(owner, workspaceId);
    const task: Task = await createTask(owner, project.id);
    const agent = await createAgent({ name: "Chat Bot" });
    const body = { data: { workspaceId, text: "Yes, go ahead." } };
    try {
      // No run can exist here: starting one answers AI_DISABLED.
      await expectCode(
        await owner.post(`/api/ai/agents/${agent.id}/runs`, {
          data: { workspaceId, taskId: task.id, prompt: "Hi" },
        }),
        403,
        "AI_DISABLED",
      );
      expect(
        await expectJson(
          await owner.get(`/api/ai/agents/runs?workspaceId=${workspaceId}`),
        ),
      ).toEqual([]);

      // Reply: no AI guard of its own, so an unknown run is a 404.
      const replyUrl = `/api/ai/agents/runs/${UNKNOWN}/reply`;
      expect(
        await expectStatus(await owner.post(replyUrl, body), 404),
      ).toContain("Run not found");
      expect(
        await expectStatus(await world.as("member").post(replyUrl, body), 404),
      ).toContain("Run not found");
      // ai:use comes first: viewers lack it, strangers have no access.
      await expectStatus(await world.as("viewer").post(replyUrl, body), 403);
      await expectStatus(await outsider.ctx.post(replyUrl, body), 403);
      await expectStatus(await world.as("anonymous").post(replyUrl, body), 401);
      await expectStatus(
        await owner.post(replyUrl, { data: { workspaceId, text: "   " } }),
        400,
      );
      await expectStatus(
        await owner.post(replyUrl, {
          data: { workspaceId, text: "ok", extra: true },
        }),
        400,
      );

      // Follow-up starts a new run, so the AI switch answers first, before
      // the run or the body is read.
      const followUrl = `/api/ai/agents/runs/${UNKNOWN}/follow-up`;
      await expectCode(await owner.post(followUrl, body), 403, "AI_DISABLED");
      await expectCode(
        await world.as("member").post(followUrl, body),
        403,
        "AI_DISABLED",
      );
      await expectCode(
        await owner.post(followUrl, { data: { workspaceId, text: "" } }),
        403,
        "AI_DISABLED",
      );
      const viewerText = await expectStatus(
        await world.as("viewer").post(followUrl, body),
        403,
      );
      expect(viewerText).not.toContain("AI_DISABLED");
      await expectStatus(await outsider.ctx.post(followUrl, body), 403);
      await expectStatus(
        await world.as("anonymous").post(followUrl, body),
        401,
      );
    } finally {
      await deleteAgent(agent.id);
      await owner.delete(`/api/project/${project.id}`);
    }
  },
);
