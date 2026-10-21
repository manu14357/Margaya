import { APIError } from "better-auth/api";
import { eq, sql } from "drizzle-orm";
import db from "../database";
import { userTable } from "../database/schema";
import { isWorkspaceManagerRole } from "../project/visibility";
import { isAgentEmail } from "./avatar";

// Better Auth guards for agent users: they can't sign in, be invited,
// join through Better Auth, or become owners or admins. Agents are managed
// only through the Agents settings (ai-agent/identity.ts).

async function isAgent(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const [row] = await db
    .select({ kind: userTable.kind })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row?.kind === "agent";
}

/** session.create.before: no session is ever created for an agent. */
export async function refuseAgentSession(session: { userId?: string }) {
  if (await isAgent(session.userId)) {
    throw new APIError("FORBIDDEN", { message: "Agents can't sign in" });
  }
}

/** beforeCreateInvitation: agents are never invited. */
export async function refuseAgentInvitation(email: string | null | undefined) {
  if (!email) return;
  if (isAgentEmail(email)) {
    throw new APIError("BAD_REQUEST", { message: "Agents can't be invited" });
  }
  const [row] = await db
    .select({ kind: userTable.kind })
    .from(userTable)
    .where(sql`lower(${userTable.email}) = lower(${email})`)
    .limit(1);
  if (row?.kind === "agent") {
    throw new APIError("BAD_REQUEST", { message: "Agents can't be invited" });
  }
}

/** beforeAddMember: agents join only through the Agents settings. */
export async function refuseAgentMember(userId: string | null | undefined) {
  if (await isAgent(userId)) {
    throw new APIError("BAD_REQUEST", {
      message: "Manage agents in workspace settings → Agents",
    });
  }
}

/** beforeUpdateMemberRole: an agent never becomes an owner or admin. */
export async function refuseAgentManagerRole(
  userId: string | null | undefined,
  role: string,
) {
  if (isWorkspaceManagerRole(role) && (await isAgent(userId))) {
    throw new APIError("BAD_REQUEST", {
      message: "Agents can't be owners or admins",
    });
  }
}
