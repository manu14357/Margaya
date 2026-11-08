import { createId } from "@paralleldrive/cuid2";
import { asc, count, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  accountTable,
  scimProviderTable,
  workspaceTable,
} from "../../database/schema";
import { recordInstanceAudit } from "../../instance-admin/audit";
import { settingsWriteLimiter } from "../../instance-admin/limits";
import { enforceRateLimits } from "../../utils/rate-limit";
import { isWorkspacePendingDeletion } from "../../workspace-deletion/lock";
import type { CreateScimConnectionBody } from "../schema";
import { newScimCredentials } from "../scim-token";
import { scimBaseUrl } from "../urls";

async function viewOf(id: string) {
  const [row] = await db
    .select({
      id: scimProviderTable.id,
      name: scimProviderTable.name,
      providerId: scimProviderTable.providerId,
      workspaceId: scimProviderTable.organizationId,
      workspaceName: workspaceTable.name,
      createdAt: scimProviderTable.createdAt,
      updatedAt: scimProviderTable.updatedAt,
    })
    .from(scimProviderTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceTable.id, scimProviderTable.organizationId),
    )
    .where(eq(scimProviderTable.id, id))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "No such connection" });
  const [managed] = await db
    .select({ value: count() })
    .from(accountTable)
    .where(eq(accountTable.providerId, row.providerId));
  const { providerId: _internal, ...view } = row;
  return { ...view, provisionedUsers: managed?.value ?? 0 };
}

/** Never selects the stored hash, so no response can carry it. */
export async function listScimConnections() {
  const rows = await db
    .select({ id: scimProviderTable.id })
    .from(scimProviderTable)
    .orderBy(asc(scimProviderTable.createdAt));
  return {
    baseUrl: scimBaseUrl(),
    items: await Promise.all(rows.map((row) => viewOf(row.id))),
  };
}

export async function createScimConnection(
  input: CreateScimConnectionBody,
  callerId: string,
) {
  await enforceRateLimits([[settingsWriteLimiter, callerId]]);
  const [workspace] = await db
    .select({ id: workspaceTable.id, name: workspaceTable.name })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, input.workspaceId))
    .limit(1);
  if (!workspace)
    throw new HTTPException(404, { message: "No such workspace" });
  if (await isWorkspacePendingDeletion(workspace.id)) {
    throw new HTTPException(409, {
      message: "This workspace is scheduled for deletion",
    });
  }

  const providerId = `scim_${createId()}`;
  const { token, storedHash } = newScimCredentials(providerId, workspace.id);
  const [row] = await db
    .insert(scimProviderTable)
    .values({
      providerId,
      scimToken: storedHash,
      organizationId: workspace.id,
      name: input.name,
      createdBy: callerId,
    })
    .returning({ id: scimProviderTable.id });
  if (!row) throw new Error("The connection was not created");

  await recordInstanceAudit({
    action: "scim.connection_created",
    target: { type: "scim_connection", id: row.id, label: input.name },
    metadata: { workspaceId: workspace.id, workspaceName: workspace.name },
    actor: { userId: callerId },
  });
  return {
    connection: await viewOf(row.id),
    baseUrl: scimBaseUrl(),
    token,
  };
}

async function findConnection(id: string) {
  const [row] = await db
    .select({
      id: scimProviderTable.id,
      name: scimProviderTable.name,
      providerId: scimProviderTable.providerId,
      workspaceId: scimProviderTable.organizationId,
    })
    .from(scimProviderTable)
    .where(eq(scimProviderTable.id, id))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "No such connection" });
  return row;
}

/** A new token; the old one stops working at once. Managed people stay linked. */
export async function rotateScimConnectionToken(id: string, callerId: string) {
  await enforceRateLimits([[settingsWriteLimiter, callerId]]);
  const connection = await findConnection(id);
  const { token, storedHash } = newScimCredentials(
    connection.providerId,
    connection.workspaceId,
  );
  await db
    .update(scimProviderTable)
    .set({ scimToken: storedHash })
    .where(eq(scimProviderTable.id, id));
  await recordInstanceAudit({
    action: "scim.token_rotated",
    target: { type: "scim_connection", id, label: connection.name },
    metadata: { workspaceId: connection.workspaceId },
    actor: { userId: callerId },
  });
  return { connection: await viewOf(id), baseUrl: scimBaseUrl(), token };
}

/**
 * Ends provisioning: the token stops working and the links go. The people it
 * added keep their accounts and memberships; removing them is a separate choice.
 */
export async function deleteScimConnection(id: string, callerId: string) {
  await enforceRateLimits([[settingsWriteLimiter, callerId]]);
  const connection = await findConnection(id);
  await db.transaction(async (tx) => {
    await tx
      .delete(accountTable)
      .where(eq(accountTable.providerId, connection.providerId));
    await tx.delete(scimProviderTable).where(eq(scimProviderTable.id, id));
  });
  await recordInstanceAudit({
    action: "scim.connection_deleted",
    target: { type: "scim_connection", id, label: connection.name },
    metadata: { workspaceId: connection.workspaceId },
    actor: { userId: callerId },
  });
  return { id, deleted: true as const };
}
