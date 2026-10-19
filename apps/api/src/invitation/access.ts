import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

export const INVITATION_NOT_FOUND = "Invitation not found";

/**
 * Loads the invitation in the path (404 when missing), checks access to its
 * workspace and sets `workspaceId`. Reads the raw path param: route
 * middleware runs before the validators.
 */
export function invitationAccess(idKey = "id") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

    const invitationId = c.req.param(idKey);
    const [invitation] = invitationId
      ? await db
          .select({ workspaceId: schema.invitationTable.workspaceId })
          .from(schema.invitationTable)
          .where(eq(schema.invitationTable.id, invitationId))
          .limit(1)
      : [];
    if (!invitation) {
      throw new HTTPException(404, { message: INVITATION_NOT_FOUND });
    }

    await validateWorkspaceAccess(
      userId,
      invitation.workspaceId,
      c.get("apiKey")?.id,
    );
    c.set("workspaceId", invitation.workspaceId);
    return next();
  };
}
