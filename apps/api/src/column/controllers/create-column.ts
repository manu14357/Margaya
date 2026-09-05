import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { VIRTUAL_STATUSES } from "../../task/validate-task-fields";
import { type ColumnGroup, resolveColumnGroupForCreate } from "../groups";

export function toSlug(name: string): string {
  const slug = name
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return /[\p{L}\p{N}]/u.test(slug) ? slug : "";
}

async function createColumn({
  projectId,
  name,
  icon,
  color,
  group: requestedGroup,
  isFinal: requestedIsFinal,
  userId,
}: {
  projectId: string;
  name: string;
  icon?: string;
  color?: string;
  group?: ColumnGroup;
  isFinal?: boolean;
  userId: string;
}) {
  const { group, isFinal } = resolveColumnGroupForCreate({
    group: requestedGroup,
    isFinal: requestedIsFinal,
  });
  const slug = toSlug(name);

  if (!slug) {
    throw new HTTPException(400, {
      message: "Column name must contain at least one alphanumeric character",
    });
  }

  if ((VIRTUAL_STATUSES as readonly string[]).includes(slug)) {
    throw new HTTPException(409, {
      message: `Column slug "${slug}" is reserved for virtual task statuses`,
    });
  }

  const existing = await db
    .select({ id: columnTable.id })
    .from(columnTable)
    .where(
      sql`${columnTable.projectId} = ${projectId} AND ${columnTable.slug} = ${slug}`,
    );

  if (existing.length > 0) {
    throw new HTTPException(409, {
      message: `Column with slug "${slug}" already exists in this project`,
    });
  }

  const [maxPos] = await db
    .select({
      maxPosition: sql<number>`COALESCE(MAX(${columnTable.position}), -1)`,
    })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId));

  const position = (maxPos?.maxPosition ?? -1) + 1;

  const [created] = await db
    .insert(columnTable)
    .values({
      projectId,
      name,
      slug,
      position,
      icon: icon || null,
      color: color || null,
      group,
      isFinal,
    })
    .returning();

  if (!created) {
    throw new HTTPException(500, { message: "Failed to create column" });
  }

  await publishEvent("column.created", {
    projectId,
    columnId: created.id,
    userId,
  });

  return created;
}

export default createColumn;
