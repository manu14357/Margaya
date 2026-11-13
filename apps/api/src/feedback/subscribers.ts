import { and, eq, isNull, or } from "drizzle-orm";
import db from "../database";
import { userTable } from "../database/schema";
import { subscribeToEvent } from "../events";
import { broadcastToUser } from "../ws";
import { FEEDBACK_CREATED, FEEDBACK_DELETED } from "./controllers/user";

// An open Feedback page refreshes for every instance admin. The hint carries
// no feedback data: the page refetches through the admin routes.
async function notifyInstanceAdmins() {
  const admins = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(
      and(
        eq(userTable.role, "admin"),
        or(isNull(userTable.banned), eq(userTable.banned, false)),
      ),
    );
  for (const admin of admins) {
    broadcastToUser(admin.id, { type: "FEEDBACK_UPDATED" });
  }
}

subscribeToEvent(FEEDBACK_CREATED, notifyInstanceAdmins);
subscribeToEvent(FEEDBACK_DELETED, notifyInstanceAdmins);
