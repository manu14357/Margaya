import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";
import { roleCeilingError, splitRoles } from "../../utils/role-ceiling";
import { INVITATION_NOT_FOUND } from "../access";

/**
 * Changes the role a pending invitation grants. Both the current and the new
 * role must be within the caller's own (see role-ceiling.ts), so nobody can
 * raise an invitation above themselves or rewrite one sent above them.
 */
export default async function updateInvitationRole({
  invitationId,
  role,
  userId,
  instanceAdmin,
}: {
  invitationId: string;
  role: string;
  userId: string;
  instanceAdmin: boolean;
}) {
  const [invitation] = await db
    .select()
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
  if (!invitation) {
    throw new HTTPException(404, { message: INVITATION_NOT_FOUND });
  }
  if (invitation.status !== "pending" || invitation.expiresAt <= new Date()) {
    throw new HTTPException(409, {
      message: "Only a pending invitation can change its role",
    });
  }

  const roles = splitRoles(role);
  const context = {
    workspaceId: invitation.workspaceId,
    userId,
    instanceAdmin,
  };
  const refusal = await roleCeilingError({ ...context, roles });
  if (refusal) {
    throw new HTTPException(refusal.status, { message: refusal.message });
  }
  // The current role may since have been deleted; only its height matters.
  const current = splitRoles(invitation.role);
  const currentRefusal = current.length
    ? await roleCeilingError({ ...context, roles: current })
    : null;
  if (currentRefusal?.status === 403) {
    throw new HTTPException(403, { message: currentRefusal.message });
  }

  const nextRole = roles.join(",");
  if (nextRole === invitation.role) return invitation;

  const [updated] = await db
    .update(schema.invitationTable)
    .set({ role: nextRole })
    .where(eq(schema.invitationTable.id, invitationId))
    .returning();
  if (!updated) {
    throw new HTTPException(404, { message: INVITATION_NOT_FOUND });
  }
  return updated;
}
