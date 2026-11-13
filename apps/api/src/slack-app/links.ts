import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  slackConnectionTable,
  slackUserLinkTable,
  workspaceTable,
} from "../database/schema";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { readLinkToken } from "./link-token";

// Account links: which Margaya user a Slack user acts as, per workspace.

const INVALID_TOKEN =
  "This link has expired or isn't valid. Run /margaya link in Slack for a new one.";

async function claimsFor(token: string, userId: string) {
  const claims = readLinkToken(token);
  if (!claims) throw new HTTPException(400, { message: INVALID_TOKEN });
  // Only members of the connected workspace can link; access answers 403/404.
  await validateWorkspaceAccess(userId, claims.workspaceId);
  const [connection] = await db
    .select({
      teamName: slackConnectionTable.teamName,
      teamId: slackConnectionTable.teamId,
    })
    .from(slackConnectionTable)
    .where(eq(slackConnectionTable.workspaceId, claims.workspaceId))
    .limit(1);
  if (
    !connection ||
    (connection.teamId && connection.teamId !== claims.teamId)
  ) {
    throw new HTTPException(400, { message: INVALID_TOKEN });
  }
  const [workspace] = await db
    .select({ name: workspaceTable.name })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, claims.workspaceId))
    .limit(1);
  return {
    claims,
    teamName: connection.teamName,
    workspaceName: workspace?.name ?? "",
  };
}

async function existingLink(claims: {
  workspaceId: string;
  teamId: string;
  slackUserId: string;
}) {
  const [row] = await db
    .select({ id: slackUserLinkTable.id, userId: slackUserLinkTable.userId })
    .from(slackUserLinkTable)
    .where(
      and(
        eq(slackUserLinkTable.workspaceId, claims.workspaceId),
        eq(slackUserLinkTable.slackTeamId, claims.teamId),
        eq(slackUserLinkTable.slackUserId, claims.slackUserId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function previewLink(token: string, userId: string) {
  const { claims, teamName, workspaceName } = await claimsFor(token, userId);
  const current = await existingLink(claims);
  return {
    workspaceId: claims.workspaceId,
    workspaceName,
    teamName,
    slackUserName: claims.slackUserName,
    linkedToYou: current?.userId === userId,
    linkedToSomeoneElse: Boolean(current && current.userId !== userId),
  };
}

export async function confirmLink(token: string, userId: string) {
  const { claims } = await claimsFor(token, userId);
  // The token proves the Slack identity, the session proves the Margaya one;
  // a newer link for the same Slack user replaces the old one.
  await db
    .insert(slackUserLinkTable)
    .values({
      workspaceId: claims.workspaceId,
      slackTeamId: claims.teamId,
      slackUserId: claims.slackUserId,
      slackUserName: claims.slackUserName,
      userId,
    })
    .onConflictDoUpdate({
      target: [
        slackUserLinkTable.workspaceId,
        slackUserLinkTable.slackTeamId,
        slackUserLinkTable.slackUserId,
      ],
      set: {
        userId,
        slackUserName: claims.slackUserName,
        createdAt: new Date(),
      },
    });
  const links = await listLinks(userId);
  const link = links.find(
    (entry) =>
      entry.workspaceId === claims.workspaceId &&
      entry.slackUserId === claims.slackUserId,
  );
  if (!link) throw new HTTPException(500, { message: "Link not saved" });
  return link;
}

export async function listLinks(userId: string) {
  const rows = await db
    .select({
      id: slackUserLinkTable.id,
      workspaceId: slackUserLinkTable.workspaceId,
      workspaceName: workspaceTable.name,
      slackTeamId: slackUserLinkTable.slackTeamId,
      slackUserId: slackUserLinkTable.slackUserId,
      slackUserName: slackUserLinkTable.slackUserName,
      teamName: slackConnectionTable.teamName,
      createdAt: slackUserLinkTable.createdAt,
    })
    .from(slackUserLinkTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceTable.id, slackUserLinkTable.workspaceId),
    )
    .leftJoin(
      slackConnectionTable,
      eq(slackConnectionTable.workspaceId, slackUserLinkTable.workspaceId),
    )
    .where(eq(slackUserLinkTable.userId, userId))
    .orderBy(desc(slackUserLinkTable.createdAt));
  return rows.map((row) => ({ ...row, teamName: row.teamName ?? null }));
}

/** Removes one of the caller's own links; others answer 404. */
export async function deleteOwnLink(linkId: string, userId: string) {
  const removed = await db
    .delete(slackUserLinkTable)
    .where(
      and(
        eq(slackUserLinkTable.id, linkId),
        eq(slackUserLinkTable.userId, userId),
      ),
    )
    .returning({ id: slackUserLinkTable.id });
  if (removed.length === 0) {
    throw new HTTPException(404, { message: "Link not found" });
  }
}

export async function unlinkSlackIdentity(input: {
  workspaceId: string;
  teamId: string;
  slackUserId: string;
}): Promise<boolean> {
  const removed = await db
    .delete(slackUserLinkTable)
    .where(
      and(
        eq(slackUserLinkTable.workspaceId, input.workspaceId),
        eq(slackUserLinkTable.slackTeamId, input.teamId),
        eq(slackUserLinkTable.slackUserId, input.slackUserId),
      ),
    )
    .returning({ id: slackUserLinkTable.id });
  return removed.length > 0;
}
