import { asc, eq } from "drizzle-orm";
import db from "../../database";
import { moduleMemberTable, userTable } from "../../database/schema";
import { listModuleLinks } from "./module-links";
import { getModuleResponse } from "./shared";

/**
 * One module (archived ones included) with its links and members. Members
 * who left the workspace are still listed; clients tolerate them.
 */
async function getModule(moduleId: string) {
  const found = await getModuleResponse(moduleId);
  const links = await listModuleLinks(moduleId);
  const members = await db
    .select({ id: userTable.id, name: userTable.name, image: userTable.image })
    .from(moduleMemberTable)
    .innerJoin(userTable, eq(userTable.id, moduleMemberTable.userId))
    .where(eq(moduleMemberTable.moduleId, moduleId))
    .orderBy(asc(userTable.name), asc(userTable.id));

  return { ...found, links, members };
}

export default getModule;
