import {
  mergeStatements,
  type PermissionStatements,
} from "@margaya/permissions";
import { and, eq } from "drizzle-orm";
import db from "../database";
import { userTable, workspaceUserTable } from "../database/schema";
import { projectReach } from "../project/visibility";
import { roleStatements, splitRoles } from "../utils/role-ceiling";

// The delegation ceiling (report 02, §4.7): a run may do only what BOTH the
// agent's role and the invoking person's current rights allow. The API still
// checks the agent itself on every call; this module computes the cap and
// re-checks the person, so an agent can never do more than its invoker.

export type PermissionMap = Record<string, string[]>;

/** Areas an agent run may ever use; everything else is dropped. */
export const AGENT_AREAS = [
  "project",
  "task",
  "label",
  "cycle",
  "module",
  "view",
  "intake",
  "page",
  "workspace",
] as const;

// Even when both roles grant them, these never reach an agent: membership,
// sharing, roles, keys and workspace settings stay with people.
const NEVER: Record<string, readonly string[]> = {
  project: ["share", "delete"],
  workspace: ["update", "delete", "manage_settings"],
};

export function satisfies(
  statements: PermissionStatements,
  required: PermissionMap,
): boolean {
  for (const [resource, actions] of Object.entries(required)) {
    const granted = statements[resource] ?? [];
    for (const action of actions) {
      if (!granted.includes(action)) return false;
    }
  }
  return true;
}

/** Actions both sets grant, limited to the agent areas. */
export function intersectStatements(
  a: PermissionStatements,
  b: PermissionStatements,
): PermissionMap {
  const out: PermissionMap = {};
  for (const area of AGENT_AREAS) {
    const left = a[area] ?? [];
    const right = new Set(b[area] ?? []);
    const never = new Set(NEVER[area] ?? []);
    const both = left.filter(
      (action) => right.has(action) && !never.has(action),
    );
    if (both.length > 0) out[area] = [...new Set(both)];
  }
  return out;
}

/** A member's statements in the workspace, or null for a non-member. */
export async function memberStatements(
  workspaceId: string,
  userId: string,
): Promise<PermissionStatements | null> {
  const [member] = await db
    .select({ role: workspaceUserTable.role })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (!member?.role) return null;
  const sets: PermissionStatements[] = [];
  for (const role of splitRoles(member.role)) {
    const statements = await roleStatements(workspaceId, role);
    if (statements) sets.push(statements);
  }
  return sets.length > 0 ? mergeStatements(...sets) : null;
}

export class RightsError extends Error {
  constructor(readonly code: "PRINCIPAL_LEFT" | "AGENT_LEFT") {
    super(code);
    this.name = "RightsError";
  }
}

/**
 * What a run may do now: the agent's role ∩ the principal's role. Throws a
 * RightsError when either is no longer a member (the run fails closed).
 */
export async function cappedStatements(input: {
  workspaceId: string;
  agentUserId: string;
  principalUserId: string;
}): Promise<PermissionMap> {
  const [agent, principal] = await Promise.all([
    memberStatements(input.workspaceId, input.agentUserId),
    memberStatements(input.workspaceId, input.principalUserId),
  ]);
  if (!agent) throw new RightsError("AGENT_LEFT");
  if (!principal) throw new RightsError("PRINCIPAL_LEFT");
  return intersectStatements(agent, principal);
}

/**
 * Whether the principal may do `required` in a project: they see it, and a
 * restricted project's role (if any) grants it too.
 */
export async function principalProjectAllows(
  workspaceId: string,
  principalUserId: string,
  projectId: string,
  required: PermissionMap,
): Promise<boolean> {
  const reach = await projectReach(principalUserId, projectId);
  if (!reach || reach.workspaceId !== workspaceId || !reach.visible) {
    return false;
  }
  if (!reach.projectRole) return true;
  const ceiling = (await roleStatements(workspaceId, reach.projectRole)) ?? {};
  return satisfies(ceiling, required);
}

/** The user's kind; agents are users with kind "agent". */
export async function userKind(
  userId: string,
): Promise<"human" | "agent" | null> {
  const [row] = await db
    .select({ kind: userTable.kind })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row?.kind ?? null;
}
