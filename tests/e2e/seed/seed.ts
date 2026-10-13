import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { ApiError, createApiContext, readJson } from "../helpers/http";
import {
  type CycleKey,
  type ModuleKey,
  type ProjectKey,
  ROLES,
  type Role,
  SEED_LABELS,
  SEED_PROJECTS,
  SEED_USERS,
  SEED_WORKSPACE,
  type SeedLabelKey,
  type SeedProject,
  type SeedUser,
  type TaskKey,
} from "./data";

// Seeds demo data through the public HTTP API only (Better Auth plus the
// Margaya routes), exactly as a client would. Every step looks up what exists
// first, so re-running it never fails on or duplicates earlier data.

export type SeedTarget = {
  apiURL: string;
  clientURL: string;
  /** When set, per-role storage states and seed.json are written here. */
  authDir?: string;
  log?: (message: string) => void;
};

export type SeededTask = {
  id: string;
  number: number | null;
  title: string;
  status: string;
};

/** A seeded project; `tasks`, `cycles` and `modules` are keyed as in data.ts. */
export type SeededProject<P extends ProjectKey = ProjectKey> = {
  id: string;
  name: string;
  slug: string;
  columns: { id: string; name: string; slug: string; group: string }[];
  /** Estimate value (e.g. "3") to point id. */
  estimate: { id: string; name: string; points: Record<string, string> } | null;
  tasks: Record<TaskKey<P>, SeededTask>;
  cycles: Record<CycleKey<P>, { id: string; name: string }>;
  modules: Record<ModuleKey<P>, { id: string; name: string }>;
};

type LooseProject = {
  id: string;
  name: string;
  slug: string;
  columns: SeededProject["columns"];
  estimate: SeededProject["estimate"];
  tasks: Record<string, SeededTask>;
  cycles: Record<string, { id: string; name: string }>;
  modules: Record<string, { id: string; name: string }>;
};

export type SeedManifest = {
  target: { apiURL: string; clientURL: string };
  seededAt: string;
  workspace: Workspace;
  users: Record<Role, SeedUser & { id: string; memberId: string | null }>;
  labels: Record<SeedLabelKey, { id: string; name: string; color: string }>;
  projects: { [P in ProjectKey]: SeededProject<P> };
};

type Session = { user: SeedUser; ctx: APIRequestContext; userId: string };

type Workspace = { id: string; name: string; slug: string };
type Member = { id: string; userId: string; role: string };
type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
};
type Label = { id: string; name: string; color: string; taskId: string | null };
type Column = {
  id: string;
  name: string;
  slug: string;
  group: string;
  position: number;
};
type BoardTask = {
  id: string;
  number: number | null;
  title: string;
  status: string;
  cycleId?: string | null;
};
type Board = {
  data: {
    columns: { tasks: BoardTask[] }[];
    archivedTasks: BoardTask[];
    plannedTasks: BoardTask[];
  };
  pagination: { totalPages: number };
};
type Estimate = {
  id: string;
  name: string;
  isActive: boolean;
  points: { id: string; value: string }[];
};
type NamedEntity = { id: string; name: string };

function formatDay(offsetDays: number): string {
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return day.toISOString().slice(0, 10);
}

async function signInOrSignUp(
  target: SeedTarget,
  user: SeedUser,
): Promise<Session> {
  const ctx = await createApiContext(target);
  const signIn = await ctx.post("/api/auth/sign-in/email", {
    data: { email: user.email, password: user.password },
  });
  if (signIn.ok()) {
    const body = await readJson<{ user: { id: string } }>(signIn, "sign-in");
    return { user, ctx, userId: body.user.id };
  }
  if (signIn.status() !== 401) {
    throw new ApiError(
      `sign-in ${user.email}`,
      signIn.status(),
      await signIn.text(),
    );
  }

  const signUp = await ctx.post("/api/auth/sign-up/email", {
    data: { name: user.name, email: user.email, password: user.password },
  });
  if (signUp.status() === 422) {
    throw new Error(
      `${user.email} already exists with a different password. Reset it, or recreate the database, then seed again.`,
    );
  }
  const body = await readJson<{ user: { id: string } }>(
    signUp,
    `sign-up ${user.email}`,
  );
  target.log?.(`created user ${user.email}`);
  return { user, ctx, userId: body.user.id };
}

async function ensureWorkspace(
  target: SeedTarget,
  owner: Session,
): Promise<Workspace> {
  const workspaces = await readJson<Workspace[]>(
    await owner.ctx.get("/api/auth/organization/list"),
    "list workspaces",
  );
  const existing = workspaces.find(
    (workspace) => workspace.name === SEED_WORKSPACE.name,
  );
  if (existing) return existing;

  let slug: string = SEED_WORKSPACE.slug;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await owner.ctx.post("/api/auth/organization/create", {
      data: { name: SEED_WORKSPACE.name, slug },
    });
    if (response.ok()) {
      target.log?.(`created workspace ${SEED_WORKSPACE.name}`);
      return readJson(response, "create workspace");
    }
    const body = await response.text();
    if (!/slug/i.test(body)) {
      throw new ApiError("create workspace", response.status(), body);
    }
    // Another instance user already owns this slug.
    slug = `${SEED_WORKSPACE.slug}-${Math.random().toString(36).slice(2, 7)}`;
  }
  throw new Error("Could not find a free workspace slug");
}

async function listMembers(
  owner: Session,
  workspaceId: string,
): Promise<Member[]> {
  const body = await readJson<{ members: Member[] } | Member[]>(
    await owner.ctx.get("/api/auth/organization/list-members", {
      params: { organizationId: workspaceId, limit: 1000 },
    }),
    "list members",
  );
  return Array.isArray(body) ? body : body.members;
}

async function ensureMembership(
  target: SeedTarget,
  owner: Session,
  invitee: Session,
  workspaceId: string,
): Promise<void> {
  const role = invitee.user.role;
  const members = await listMembers(owner, workspaceId);
  const member = members.find((m) => m.userId === invitee.userId);

  if (member) {
    if (member.role !== role) {
      await readJson(
        await owner.ctx.post("/api/auth/organization/update-member-role", {
          data: { memberId: member.id, role, organizationId: workspaceId },
        }),
        `restore ${invitee.user.email} role`,
      );
      target.log?.(`restored ${invitee.user.email} to ${role}`);
    }
    return;
  }

  const invitations = await readJson<Invitation[]>(
    await owner.ctx.get("/api/auth/organization/list-invitations", {
      params: { organizationId: workspaceId },
    }),
    "list invitations",
  );
  let invitation = invitations.find(
    (i) =>
      i.email.toLowerCase() === invitee.user.email &&
      i.status === "pending" &&
      new Date(i.expiresAt).getTime() > Date.now(),
  );
  if (invitation && invitation.role !== role) {
    await readJson(
      await owner.ctx.post("/api/auth/organization/cancel-invitation", {
        data: { invitationId: invitation.id },
      }),
      "cancel stale invitation",
    );
    invitation = undefined;
  }
  if (!invitation) {
    invitation = await readJson<Invitation>(
      await owner.ctx.post("/api/auth/organization/invite-member", {
        data: { email: invitee.user.email, role, organizationId: workspaceId },
      }),
      `invite ${invitee.user.email}`,
    );
  }

  await readJson(
    await invitee.ctx.post("/api/auth/organization/accept-invitation", {
      data: { invitationId: invitation.id },
    }),
    `accept invitation for ${invitee.user.email}`,
  );
  target.log?.(`${invitee.user.email} joined as ${role}`);
}

async function ensureLabels(
  owner: Session,
  workspaceId: string,
): Promise<SeedManifest["labels"]> {
  const labels = await readJson<Label[]>(
    await owner.ctx.get(`/api/label/workspace/${workspaceId}`),
    "list labels",
  );
  const result = {} as SeedManifest["labels"];
  for (const seedLabel of SEED_LABELS) {
    let label = labels.find(
      (l) => l.taskId === null && l.name === seedLabel.name,
    );
    if (!label) {
      label = await readJson<Label>(
        await owner.ctx.post("/api/label", {
          data: {
            name: seedLabel.name,
            color: seedLabel.color,
            workspaceId,
          },
        }),
        `create label ${seedLabel.name}`,
      );
    }
    result[seedLabel.key] = {
      id: label.id,
      name: label.name,
      color: label.color,
    };
  }
  return result;
}

async function listBoardTasks(
  ctx: APIRequestContext,
  projectId: string,
): Promise<BoardTask[]> {
  const tasks: BoardTask[] = [];
  for (let page = 1; ; page += 1) {
    const board = await readJson<Board>(
      await ctx.get(`/api/task/tasks/${projectId}`, {
        params: {
          limit: 100,
          page,
          sortBy: "createdAt",
          sortOrder: "asc",
        },
      }),
      "list tasks",
    );
    for (const column of board.data.columns) tasks.push(...column.tasks);
    tasks.push(...board.data.plannedTasks, ...board.data.archivedTasks);
    if (page >= board.pagination.totalPages) return tasks;
  }
}

async function ensureProject(
  target: SeedTarget,
  sessions: Record<Role, Session>,
  workspaceId: string,
  labels: SeedManifest["labels"],
  spec: SeedProject,
): Promise<LooseProject> {
  const owner = sessions.owner;
  const projects = await readJson<
    { id: string; name: string; slug: string; archivedAt: string | null }[]
  >(
    await owner.ctx.get("/api/project", {
      params: { workspaceId, includeArchived: "true" },
    }),
    "list projects",
  );
  let project = projects.find(
    (p) => p.slug.toLowerCase() === spec.slug.toLowerCase(),
  );
  if (!project) {
    project = await readJson(
      await owner.ctx.post("/api/project", {
        data: {
          name: spec.name,
          workspaceId,
          icon: spec.icon,
          slug: spec.slug,
        },
      }),
      `create project ${spec.name}`,
    );
    target.log?.(`created project ${spec.name}`);
  } else if (project.archivedAt) {
    await readJson(
      await owner.ctx.put(`/api/project/${project.id}/unarchive`),
      `unarchive project ${spec.name}`,
    );
  }
  if (!project) throw new Error(`Project ${spec.name} was not created`);
  const projectId = project.id;

  await readJson(
    await owner.ctx.patch(`/api/project/${projectId}/features`, {
      data: spec.features,
    }),
    `enable features on ${spec.name}`,
  );

  // Columns
  let columns = await readJson<Column[]>(
    await owner.ctx.get(`/api/column/${projectId}`),
    "list columns",
  );
  for (const extra of spec.extraColumns) {
    if (columns.some((c) => c.name === extra.name)) continue;
    const created = await readJson<Column>(
      await owner.ctx.post(`/api/column/${projectId}`, {
        data: { name: extra.name, group: extra.group },
      }),
      `create column ${extra.name}`,
    );
    if (extra.first) {
      const ordered = [created, ...columns.filter((c) => c.id !== created.id)];
      await readJson(
        await owner.ctx.put(`/api/column/reorder/${projectId}`, {
          data: {
            columns: ordered.map((c, position) => ({ id: c.id, position })),
          },
        }),
        "reorder columns",
      );
    }
    columns = await readJson<Column[]>(
      await owner.ctx.get(`/api/column/${projectId}`),
      "list columns",
    );
  }

  // Estimates
  let estimate: LooseProject["estimate"] = null;
  if (spec.estimate && spec.features.estimatesEnabled) {
    const list = await readJson<{
      activeEstimateId: string | null;
      estimates: Estimate[];
    }>(await owner.ctx.get(`/api/estimate/${projectId}`), "list estimates");
    let system = list.estimates.find((e) => e.name === spec.estimate?.name);
    if (!system) {
      system = await readJson<Estimate>(
        await owner.ctx.post(`/api/estimate/${projectId}`, {
          data: spec.estimate,
        }),
        `create estimate ${spec.estimate.name}`,
      );
    }
    if (!system.isActive && list.activeEstimateId === null) {
      await readJson(
        await owner.ctx.post(
          `/api/estimate/${projectId}/${system.id}/activate`,
          { data: { mapping: [] } },
        ),
        "activate estimate",
      );
    }
    estimate = {
      id: system.id,
      name: system.name,
      points: Object.fromEntries(system.points.map((p) => [p.value, p.id])),
    };
  }

  // Tasks
  const existingTasks = await listBoardTasks(owner.ctx, projectId);
  const tasks: LooseProject["tasks"] = {};
  for (const seedTask of spec.tasks) {
    let task = existingTasks.find((t) => t.title === seedTask.title);
    if (!task) {
      const estimatePointId =
        seedTask.estimate && estimate
          ? (estimate.points[seedTask.estimate] ?? null)
          : undefined;
      task = await readJson<BoardTask>(
        await owner.ctx.post(`/api/task/${projectId}`, {
          data: {
            title: seedTask.title,
            description: seedTask.description,
            priority: seedTask.priority,
            status: seedTask.status,
            assigneeIds: seedTask.assignees.map(
              (role) => sessions[role].userId,
            ),
            ...(estimatePointId === undefined ? {} : { estimatePointId }),
          },
        }),
        `create task ${seedTask.title}`,
      );
      existingTasks.push({ ...task, cycleId: null });
    }
    tasks[seedTask.key] = {
      id: task.id,
      number: task.number,
      title: task.title,
      status: task.status,
    };

    if (seedTask.labels.length > 0) {
      const taskLabels = await readJson<Label[]>(
        await owner.ctx.get(`/api/label/task/${task.id}`),
        "list task labels",
      );
      for (const labelKey of seedTask.labels) {
        const label = labels[labelKey];
        if (taskLabels.some((l) => l.name === label.name)) continue;
        await readJson(
          await owner.ctx.put(`/api/label/${label.id}/task`, {
            data: { taskId: task.id },
          }),
          `label ${seedTask.title}`,
        );
      }
    }
  }

  // Cycles
  const cycles: LooseProject["cycles"] = {};
  if (spec.cycles.length > 0) {
    const listed = [
      ...(await readJson<NamedEntity[]>(
        await owner.ctx.get(`/api/cycle/project/${projectId}`, {
          params: { view: "all" },
        }),
        "list cycles",
      )),
      ...(await readJson<NamedEntity[]>(
        await owner.ctx.get(`/api/cycle/project/${projectId}`, {
          params: { view: "archived" },
        }),
        "list archived cycles",
      )),
    ];
    for (const seedCycle of spec.cycles) {
      let cycle = listed.find((c) => c.name === seedCycle.name);
      if (!cycle) {
        cycle = await readJson<NamedEntity>(
          await owner.ctx.post(`/api/cycle/project/${projectId}`, {
            data: {
              name: seedCycle.name,
              description: seedCycle.description,
              startDate:
                seedCycle.startOffsetDays === null
                  ? null
                  : formatDay(seedCycle.startOffsetDays),
              endDate:
                seedCycle.endOffsetDays === null
                  ? null
                  : formatDay(seedCycle.endOffsetDays),
            },
          }),
          `create cycle ${seedCycle.name}`,
        );
        const taskIds = seedCycle.tasks.flatMap((key) => {
          const id = tasks[key]?.id;
          return id ? [id] : [];
        });
        if (taskIds.length > 0) {
          await readJson(
            await owner.ctx.post(`/api/cycle/${cycle.id}/tasks`, {
              data: { taskIds },
            }),
            `add tasks to ${seedCycle.name}`,
          );
        }
      }
      cycles[seedCycle.key] = { id: cycle.id, name: cycle.name };
    }
  }

  // Modules
  const modules: LooseProject["modules"] = {};
  if (spec.modules.length > 0) {
    const listed = [
      ...(await readJson<NamedEntity[]>(
        await owner.ctx.get(`/api/module/project/${projectId}`, {
          params: { view: "active" },
        }),
        "list modules",
      )),
      ...(await readJson<NamedEntity[]>(
        await owner.ctx.get(`/api/module/project/${projectId}`, {
          params: { view: "archived" },
        }),
        "list archived modules",
      )),
    ];
    for (const seedModule of spec.modules) {
      let mod = listed.find((m) => m.name === seedModule.name);
      if (!mod) {
        mod = await readJson<NamedEntity>(
          await owner.ctx.post(`/api/module/project/${projectId}`, {
            data: {
              name: seedModule.name,
              description: seedModule.description,
              status: seedModule.status,
              leadId: seedModule.lead ? sessions[seedModule.lead].userId : null,
              memberIds: seedModule.members.map(
                (role) => sessions[role].userId,
              ),
            },
          }),
          `create module ${seedModule.name}`,
        );
        const taskIds = seedModule.tasks.flatMap((key) => {
          const id = tasks[key]?.id;
          return id ? [id] : [];
        });
        if (taskIds.length > 0) {
          await readJson(
            await owner.ctx.post(`/api/module/${mod.id}/tasks`, {
              data: { taskIds },
            }),
            `add tasks to ${seedModule.name}`,
          );
        }
      }
      modules[seedModule.key] = { id: mod.id, name: mod.name };
    }
  }

  return {
    id: projectId,
    name: project.name,
    slug: project.slug,
    columns: columns.map(({ id, name, slug, group }) => ({
      id,
      name,
      slug,
      group,
    })),
    estimate,
    tasks,
    cycles,
    modules,
  };
}

export async function runSeed(target: SeedTarget): Promise<SeedManifest> {
  const sessions = {} as Record<Role, Session>;
  try {
    // The owner signs up first: on an empty instance the first account
    // becomes the instance administrator.
    for (const role of ROLES) {
      sessions[role] = await signInOrSignUp(target, SEED_USERS[role]);
    }

    const workspace = await ensureWorkspace(target, sessions.owner);
    for (const role of ROLES) {
      if (role === "owner") continue;
      await ensureMembership(
        target,
        sessions.owner,
        sessions[role],
        workspace.id,
      );
    }

    const labels = await ensureLabels(sessions.owner, workspace.id);
    const projects: Record<string, LooseProject> = {};
    for (const key of Object.keys(SEED_PROJECTS) as ProjectKey[]) {
      projects[key] = await ensureProject(
        target,
        sessions,
        workspace.id,
        labels,
        SEED_PROJECTS[key],
      );
    }

    const members = await listMembers(sessions.owner, workspace.id);
    const users = {} as SeedManifest["users"];
    for (const role of ROLES) {
      const session = sessions[role];
      await readJson(
        await session.ctx.post("/api/auth/organization/set-active", {
          data: { organizationId: workspace.id },
        }),
        `set active workspace for ${session.user.email}`,
      );
      users[role] = {
        ...session.user,
        id: session.userId,
        memberId: members.find((m) => m.userId === session.userId)?.id ?? null,
      };
    }

    const manifest: SeedManifest = {
      target: { apiURL: target.apiURL, clientURL: target.clientURL },
      seededAt: new Date().toISOString(),
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      },
      users,
      labels,
      // Keys come from SEED_PROJECTS, so the loose records match the typed ones.
      projects: projects as unknown as SeedManifest["projects"],
    };

    if (target.authDir) {
      await mkdir(target.authDir, { recursive: true });
      for (const role of ROLES) {
        await sessions[role].ctx.storageState({
          path: path.join(target.authDir, `${role}.json`),
        });
      }
      await writeFile(
        path.join(target.authDir, "seed.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    }

    return manifest;
  } finally {
    await Promise.all(
      Object.values(sessions).map((session) => session.ctx.dispose()),
    );
  }
}
