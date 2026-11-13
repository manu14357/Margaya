import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { startOfUtcMonth } from "../ai/usage";
import { recordAudit } from "../audit-log/record";
import db from "../database";
import {
  agentTable,
  aiSkillTable,
  aiUsageTable,
  projectTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import { jsonHttpError } from "../estimate/write";
import { publishEvent } from "../events";
import { isWorkspaceManagerRole } from "../project/visibility";
import { removeUserFromAllAssignments } from "../task/assignee-writes";
import { roleCeilingError, roleStatements } from "../utils/role-ceiling";
import { AGENT_AVATAR, agentEmail } from "./avatar";

// Agents are users with kind "agent" (report 02, §4.7): a workspace_member
// row with a role, so mentions, assignee pickers and permissions work
// unchanged. They have no account row (no password, no OAuth link), so they
// can't sign in; Better Auth refuses their sessions too (ai-agent/guards).

export type AgentTier = "fast" | "balanced" | "deep";

export const MAX_AGENTS_PER_WORKSPACE = 25;

export type AgentInput = {
  name: string;
  description?: string | null;
  instructions?: string;
  modelTier?: AgentTier;
  providerOverride?: "local" | null;
  role?: string;
  enabled?: boolean;
  monthlyBudgetMicros?: number | null;
  projectIds?: string[] | null;
  skillIds?: string[];
  webAccess?: boolean;
};

/** Agents may hold any role but owner and admin, within the caller's own. */
async function assertAgentRole(
  workspaceId: string,
  actorId: string,
  role: string,
  instanceAdmin: boolean,
) {
  if (role.includes(",") || isWorkspaceManagerRole(role)) {
    throw new HTTPException(400, {
      message: "Agents can't be owners or admins",
    });
  }
  if (!(await roleStatements(workspaceId, role))) {
    throw new HTTPException(400, { message: `Unknown role "${role}"` });
  }
  const ceiling = await roleCeilingError({
    workspaceId,
    userId: actorId,
    roles: [role],
    instanceAdmin,
  });
  if (ceiling) {
    throw new HTTPException(ceiling.status, { message: ceiling.message });
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The stable code of a name clash, which the web translates. */
export const AGENT_NAME_TAKEN = "AGENT_NAME_TAKEN";
// pg_advisory_xact_lock class for agent names (1524–1529 are taken).
const AGENT_NAME_LOCK = 1530;

/**
 * An agent's name must not match (ignoring case) another member's of the
 * workspace, agent or person: @mentions and pickers show names, so two
 * "Maya"s are ambiguous. Serialized per workspace so two concurrent
 * creates can't both take a name.
 */
async function assertNameFree(
  tx: Tx,
  workspaceId: string,
  name: string,
  exceptUserId?: string,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${AGENT_NAME_LOCK}, hashtext(${workspaceId}))`,
  );
  const [clash] = await tx
    .select({ kind: userTable.kind })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        sql`lower(trim(${userTable.name})) = lower(${name})`,
        exceptUserId ? ne(userTable.id, exceptUserId) : undefined,
      ),
    )
    .limit(1);
  if (clash) {
    throw jsonHttpError(409, {
      code: AGENT_NAME_TAKEN,
      message:
        clash.kind === "agent"
          ? `An agent named "${name}" already exists in this workspace`
          : `A member of this workspace is already named "${name}"`,
    });
  }
}

// The person an agent's intake runs act for.
const intakeByUser = alias(userTable, "intake_trigger_user");

const agentColumns = {
  id: agentTable.id,
  userId: agentTable.userId,
  workspaceId: agentTable.workspaceId,
  name: agentTable.name,
  description: agentTable.description,
  instructions: agentTable.instructions,
  modelTier: agentTable.modelTier,
  providerOverride: agentTable.providerOverride,
  ownerId: agentTable.ownerId,
  enabled: agentTable.enabled,
  monthlyBudgetMicros: agentTable.monthlyBudgetMicros,
  projectIds: agentTable.projectIds,
  skillIds: agentTable.skillIds,
  webAccess: agentTable.webAccess,
  intakeTriggerEnabled: agentTable.intakeTriggerEnabled,
  intakeTriggerPrompt: agentTable.intakeTriggerPrompt,
  intakeTriggerBy: agentTable.intakeTriggerBy,
  intakeTriggerByName: intakeByUser.name,
  createdAt: agentTable.createdAt,
  updatedAt: agentTable.updatedAt,
  image: userTable.image,
  role: workspaceUserTable.role,
};

export type AgentRow = {
  id: string;
  userId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  instructions: string;
  modelTier: AgentTier;
  providerOverride: "local" | null;
  ownerId: string | null;
  enabled: boolean;
  monthlyBudgetMicros: number | null;
  /** Null: every project the role reaches. */
  projectIds: string[] | null;
  skillIds: string[];
  webAccess: boolean;
  intakeTriggerEnabled: boolean;
  intakeTriggerPrompt: string | null;
  /** The person intake runs act for. */
  intakeTriggerBy: string | null;
  intakeTriggerByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  image: string | null;
  role: string | null;
};

function agentQuery() {
  return db
    .select(agentColumns)
    .from(agentTable)
    .innerJoin(userTable, eq(userTable.id, agentTable.userId))
    .leftJoin(intakeByUser, eq(intakeByUser.id, agentTable.intakeTriggerBy))
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, agentTable.userId),
        eq(workspaceUserTable.workspaceId, agentTable.workspaceId),
      ),
    );
}

export async function getAgent(
  workspaceId: string,
  agentId: string,
): Promise<AgentRow> {
  const [row] = await agentQuery()
    .where(
      and(eq(agentTable.id, agentId), eq(agentTable.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Agent not found" });
  return row as AgentRow;
}

/** The agent behind an agent user, or null for people. */
export async function agentOfUser(userId: string): Promise<AgentRow | null> {
  const [row] = await agentQuery()
    .where(eq(agentTable.userId, userId))
    .limit(1);
  return (row as AgentRow | undefined) ?? null;
}

/** This month's spend of each agent (UTC month), from the AI ledger. */
async function monthSpend(agentIds: string[]): Promise<Map<string, number>> {
  if (agentIds.length === 0) return new Map();
  const rows = await db
    .select({
      agentId: aiUsageTable.agentId,
      total: sql<string>`coalesce(sum(${aiUsageTable.costMicros}), 0)`,
    })
    .from(aiUsageTable)
    .where(
      and(
        inArray(aiUsageTable.agentId, agentIds),
        gte(aiUsageTable.createdAt, startOfUtcMonth(new Date())),
      ),
    )
    .groupBy(aiUsageTable.agentId);
  return new Map(rows.map((row) => [row.agentId ?? "", Number(row.total)]));
}

export async function agentMonthSpendMicros(agentId: string): Promise<number> {
  return (await monthSpend([agentId])).get(agentId) ?? 0;
}

/**
 * The workspace's agents. Configuration (instructions, budget, spend) only
 * for people with ai:manage; everyone else sees who is an agent.
 */
export async function listAgents(workspaceId: string, canManage: boolean) {
  const rows = (await agentQuery()
    .where(eq(agentTable.workspaceId, workspaceId))
    .orderBy(asc(agentTable.name))) as AgentRow[];
  const spend = canManage ? await monthSpend(rows.map((row) => row.id)) : null;
  return rows.map((row) =>
    serializeAgent(row, spend?.get(row.id) ?? 0, canManage),
  );
}

export function serializeAgent(
  row: AgentRow,
  monthSpendMicros: number,
  canManage: boolean,
) {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    image: row.image,
    role: row.role,
    enabled: row.enabled,
    modelTier: row.modelTier,
    providerOverride: row.providerOverride,
    instructions: canManage ? row.instructions : null,
    monthlyBudgetMicros: canManage ? row.monthlyBudgetMicros : null,
    monthSpendMicros: canManage ? monthSpendMicros : null,
    projectIds: canManage ? row.projectIds : null,
    skillIds: canManage ? row.skillIds : null,
    webAccess: row.webAccess,
    intakeTrigger: canManage
      ? {
          enabled: row.intakeTriggerEnabled,
          prompt: row.intakeTriggerPrompt,
          runsAs: row.intakeTriggerBy
            ? { id: row.intakeTriggerBy, name: row.intakeTriggerByName ?? "" }
            : null,
        }
      : null,
    ownerId: row.ownerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The agent's project allow-list and skills must name live projects and
 * shared skills of its own workspace; anything else is a 400.
 */
async function assertScopeAndSkills(
  workspaceId: string,
  agent: Pick<AgentInput, "projectIds" | "skillIds">,
) {
  const projectIds = [...new Set(agent.projectIds ?? [])];
  if (projectIds.length > 0) {
    const found = await db
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          inArray(projectTable.id, projectIds),
          isNull(projectTable.deletedAt),
        ),
      );
    if (found.length !== projectIds.length) {
      throw new HTTPException(400, {
        message: "projectIds: not a project of this workspace",
      });
    }
  }
  if (agent.projectIds && agent.projectIds.length === 0) {
    throw new HTTPException(400, {
      message: "projectIds: choose at least one project, or null for all",
    });
  }
  const skillIds = [...new Set(agent.skillIds ?? [])];
  if (skillIds.length > 0) {
    const found = await db
      .select({ id: aiSkillTable.id })
      .from(aiSkillTable)
      .where(
        and(
          eq(aiSkillTable.workspaceId, workspaceId),
          inArray(aiSkillTable.id, skillIds),
          // Agents serve everyone: only skills shared with the workspace.
          eq(aiSkillTable.shared, true),
        ),
      );
    if (found.length !== skillIds.length) {
      throw new HTTPException(400, {
        message: "skillIds: not a shared skill of this workspace",
      });
    }
  }
}

export async function createAgent(input: {
  workspaceId: string;
  actorId: string;
  instanceAdmin: boolean;
  agent: AgentInput;
}) {
  const role = input.agent.role ?? "member";
  await assertAgentRole(
    input.workspaceId,
    input.actorId,
    role,
    input.instanceAdmin,
  );
  await assertScopeAndSkills(input.workspaceId, input.agent);
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentTable)
    .where(eq(agentTable.workspaceId, input.workspaceId));
  if (Number(count) >= MAX_AGENTS_PER_WORKSPACE) {
    throw new HTTPException(409, {
      message: `A workspace can have at most ${MAX_AGENTS_PER_WORKSPACE} agents`,
    });
  }

  const agentId = createId();
  const name = input.agent.name.trim();
  await db.transaction(async (tx) => {
    await assertNameFree(tx, input.workspaceId, name);
    const [user] = await tx
      .insert(userTable)
      .values({
        name,
        email: agentEmail(agentId),
        emailVerified: false,
        image: AGENT_AVATAR,
        kind: "agent",
      })
      .returning({ id: userTable.id });
    if (!user)
      throw new HTTPException(500, { message: "Could not create agent" });
    await tx.insert(workspaceUserTable).values({
      workspaceId: input.workspaceId,
      userId: user.id,
      role,
      joinedAt: new Date(),
    });
    await tx.insert(agentTable).values({
      id: agentId,
      userId: user.id,
      workspaceId: input.workspaceId,
      name,
      description: input.agent.description?.trim() || null,
      instructions: input.agent.instructions?.trim() ?? "",
      modelTier: input.agent.modelTier ?? "balanced",
      providerOverride: input.agent.providerOverride ?? null,
      ownerId: input.actorId,
      enabled: input.agent.enabled ?? true,
      monthlyBudgetMicros: input.agent.monthlyBudgetMicros ?? null,
      projectIds: input.agent.projectIds
        ? [...new Set(input.agent.projectIds)]
        : null,
      skillIds: [...new Set(input.agent.skillIds ?? [])],
      webAccess: input.agent.webAccess ?? false,
    });
  });

  const agent = await getAgent(input.workspaceId, agentId);
  await recordAudit({
    workspaceId: input.workspaceId,
    action: "agent.created",
    target: { type: "agent", id: agentId, label: name },
    metadata: {
      role,
      modelTier: agent.modelTier,
      webAccess: agent.webAccess,
    },
  });
  await publishEvent("agent.changed", { workspaceId: input.workspaceId });
  return serializeAgent(agent, 0, true);
}

export async function updateAgent(input: {
  workspaceId: string;
  agentId: string;
  actorId: string;
  instanceAdmin: boolean;
  patch: Partial<AgentInput>;
}) {
  const current = await getAgent(input.workspaceId, input.agentId);
  const { patch } = input;
  if (patch.role !== undefined && patch.role !== current.role) {
    await assertAgentRole(
      input.workspaceId,
      input.actorId,
      patch.role,
      input.instanceAdmin,
    );
  }
  await assertScopeAndSkills(input.workspaceId, patch);
  const name = patch.name?.trim();
  await db.transaction(async (tx) => {
    // Only a rename is checked, so older duplicates can still be edited.
    if (
      name !== undefined &&
      name.toLowerCase() !== current.name.toLowerCase()
    ) {
      await assertNameFree(tx, input.workspaceId, name, current.userId);
    }
    const values: Partial<typeof agentTable.$inferInsert> = {};
    if (name !== undefined) values.name = name;
    if (patch.description !== undefined) {
      values.description = patch.description?.trim() || null;
    }
    if (patch.instructions !== undefined) {
      values.instructions = patch.instructions.trim();
    }
    if (patch.modelTier !== undefined) values.modelTier = patch.modelTier;
    if (patch.providerOverride !== undefined) {
      values.providerOverride = patch.providerOverride;
    }
    if (patch.enabled !== undefined) values.enabled = patch.enabled;
    if (patch.monthlyBudgetMicros !== undefined) {
      values.monthlyBudgetMicros = patch.monthlyBudgetMicros;
    }
    if (patch.projectIds !== undefined) {
      values.projectIds = patch.projectIds
        ? [...new Set(patch.projectIds)]
        : null;
    }
    if (patch.skillIds !== undefined) {
      values.skillIds = [...new Set(patch.skillIds)];
    }
    if (patch.webAccess !== undefined) values.webAccess = patch.webAccess;
    if (Object.keys(values).length > 0) {
      await tx
        .update(agentTable)
        .set(values)
        .where(eq(agentTable.id, current.id));
    }
    if (name !== undefined) {
      await tx
        .update(userTable)
        .set({ name })
        .where(eq(userTable.id, current.userId));
    }
    if (patch.role !== undefined && patch.role !== current.role) {
      await tx
        .update(workspaceUserTable)
        .set({ role: patch.role })
        .where(
          and(
            eq(workspaceUserTable.userId, current.userId),
            eq(workspaceUserTable.workspaceId, input.workspaceId),
          ),
        );
    }
  });

  const agent = await getAgent(input.workspaceId, input.agentId);
  await recordAudit({
    workspaceId: input.workspaceId,
    action: "agent.updated",
    target: { type: "agent", id: agent.id, label: agent.name },
    // Field names only: instructions may be long.
    metadata: { fields: Object.keys(patch) },
  });
  await publishEvent("agent.changed", { workspaceId: input.workspaceId });
  // The agent's name shows on its tasks, comments and activity.
  if (name !== undefined && name !== current.name) {
    await publishEvent("user.profile_changed", { userId: current.userId });
  }
  return serializeAgent(agent, await agentMonthSpendMicros(agent.id), true);
}

/**
 * Deletes the agent and its user (membership, keys and mentions go with
 * it). Its runs stay in the Agent Desk history without the agent.
 */
export async function deleteAgent(input: {
  workspaceId: string;
  agentId: string;
}) {
  const agent = await getAgent(input.workspaceId, input.agentId);
  // Like account deletion: keep the tasks' first-assignee mirror in step.
  await removeUserFromAllAssignments(agent.userId);
  await db.delete(userTable).where(eq(userTable.id, agent.userId));
  await recordAudit({
    workspaceId: input.workspaceId,
    action: "agent.deleted",
    target: { type: "agent", id: agent.id, label: agent.name },
  });
  await publishEvent("agent.changed", { workspaceId: input.workspaceId });
  return { id: agent.id };
}
