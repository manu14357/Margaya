import { APIError, getSessionFromCtx } from "better-auth/api";
import { eq } from "drizzle-orm";
import db from "../database";
import { workspaceTable } from "../database/schema";
import { isWorkspaceGuest } from "../project/visibility";

// Better Auth answers these reads for any member of a workspace, and they hold
// its member and invitation lists. A guest sees neither (project/visibility.ts),
// but the app still needs their own row to know their role, so each answer is
// narrowed to that one row rather than refused.
const GUEST_NARROWED_PATHS = new Set([
  "/organization/list-members",
  "/organization/get-full-organization",
  "/organization/list-invitations",
  "/organization/get-active-member-role",
]);

type AuthContext = Parameters<typeof getSessionFromCtx>[0];

export function isGuestNarrowedPath(path: string | undefined) {
  return Boolean(path && GUEST_NARROWED_PATHS.has(path));
}

async function requestedWorkspaceId(
  query: Record<string, unknown> | undefined,
  activeWorkspaceId: string | null | undefined,
) {
  if (typeof query?.organizationSlug === "string") {
    const [workspace] = await db
      .select({ id: workspaceTable.id })
      .from(workspaceTable)
      .where(eq(workspaceTable.slug, query.organizationSlug))
      .limit(1);
    return workspace?.id ?? null;
  }
  if (typeof query?.organizationId === "string") return query.organizationId;
  return activeWorkspaceId ?? null;
}

/**
 * The after hook of the paths above: the same answer holding only the caller,
 * or nothing to change when they are not a guest (or the read failed).
 */
export async function narrowOrganizationReadForGuest(ctx: AuthContext) {
  const returned = ctx.context.returned as Record<string, unknown> | undefined;
  if (!returned || returned instanceof Error) return;

  const session = await getSessionFromCtx(ctx, { disableRefresh: true }).catch(
    () => null,
  );
  if (!session) return;
  const userId = session.user.id;
  const activeWorkspaceId = (
    session.session as { activeOrganizationId?: string | null }
  ).activeOrganizationId;

  if (ctx.path === "/organization/get-full-organization") {
    if (typeof returned.id !== "string") return;
    if (!(await isWorkspaceGuest(userId, returned.id))) return;
    const members = (returned.members ?? []) as { userId: string }[];
    return ctx.json({
      ...returned,
      members: members.filter((member) => member.userId === userId),
      invitations: [],
    });
  }

  const workspaceId = await requestedWorkspaceId(ctx.query, activeWorkspaceId);
  if (!workspaceId || !(await isWorkspaceGuest(userId, workspaceId))) return;

  if (ctx.path === "/organization/list-invitations") return ctx.json([]);

  if (ctx.path === "/organization/get-active-member-role") {
    if (ctx.query?.userId && ctx.query.userId !== userId) {
      throw new APIError("FORBIDDEN", {
        message: "You can't read another member's role",
      });
    }
    return;
  }

  const members = (returned.members ?? []) as { userId: string }[];
  const own = members.filter((member) => member.userId === userId);
  return ctx.json({ members: own, total: own.length });
}
