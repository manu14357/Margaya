import { and, count, desc, eq, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { moduleLinkTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { normalizeLinkTitle, normalizeLinkUrl } from "../../utils/link-url";
import type { Transaction } from "../queries";
import { assertNotArchived, isUniqueViolation, lockModule } from "./shared";

export const MAX_MODULE_LINKS = 100;
const LINK_NOT_FOUND = "Link not found";
const DUPLICATE_LINK = "This link is already added to this module";

type LinkAction = "created" | "updated" | "deleted";

/** The one link rule (utils/link-url.ts), shared with task and quick links. */
function requireLinkUrl(raw: string): string {
  const result = normalizeLinkUrl(raw);
  if (!result.ok) throw new HTTPException(400, { message: result.message });
  return result.url;
}

function requireLinkTitle(raw: string | null | undefined) {
  const result = normalizeLinkTitle(raw);
  if (!result.ok) throw new HTTPException(400, { message: result.message });
  return result.title;
}

/** Newest first. */
export async function listModuleLinks(moduleId: string) {
  return db
    .select()
    .from(moduleLinkTable)
    .where(eq(moduleLinkTable.moduleId, moduleId))
    .orderBy(desc(moduleLinkTable.createdAt), desc(moduleLinkTable.id));
}

async function assertUrlAvailable(
  tx: Transaction,
  moduleId: string,
  url: string,
  exceptLinkId?: string,
) {
  const [conflict] = await tx
    .select({ id: moduleLinkTable.id })
    .from(moduleLinkTable)
    .where(
      and(
        eq(moduleLinkTable.moduleId, moduleId),
        eq(moduleLinkTable.url, url),
        exceptLinkId ? ne(moduleLinkTable.id, exceptLinkId) : undefined,
      ),
    )
    .limit(1);
  if (conflict) throw new HTTPException(409, { message: DUPLICATE_LINK });
}

async function requireLink(tx: Transaction, moduleId: string, linkId: string) {
  const [link] = await tx
    .select()
    .from(moduleLinkTable)
    .where(
      and(
        eq(moduleLinkTable.id, linkId),
        eq(moduleLinkTable.moduleId, moduleId),
      ),
    )
    .limit(1);
  if (!link) throw new HTTPException(404, { message: LINK_NOT_FOUND });
  return link;
}

/**
 * Runs a link write under the module's row lock (archived modules refuse
 * it), maps a lost race on the URL index to the usual 409, and publishes
 * `module.links_changed` afterwards.
 */
async function writeLink<T extends { id: string }>(
  moduleId: string,
  userId: string,
  action: LinkAction,
  write: (tx: Transaction) => Promise<T>,
): Promise<T> {
  let projectId = "";
  let result: T;
  try {
    result = await db.transaction(async (tx) => {
      const found = await lockModule(tx, moduleId);
      assertNotArchived(found);
      projectId = found.projectId;
      return write(tx);
    });
  } catch (error) {
    if (isUniqueViolation(error, "module_link_module_url_unique")) {
      throw new HTTPException(409, { message: DUPLICATE_LINK });
    }
    throw error;
  }

  await publishEvent("module.links_changed", {
    moduleId,
    projectId,
    userId,
    action,
    linkId: result.id,
  });
  return result;
}

export async function createModuleLink({
  moduleId,
  userId,
  url,
  title,
}: {
  moduleId: string;
  userId: string;
  url: string;
  title?: string | null;
}) {
  const normalized = requireLinkUrl(url);

  return writeLink(moduleId, userId, "created", async (tx) => {
    const [existing] = await tx
      .select({ total: count() })
      .from(moduleLinkTable)
      .where(eq(moduleLinkTable.moduleId, moduleId));
    if (Number(existing?.total ?? 0) >= MAX_MODULE_LINKS) {
      throw new HTTPException(400, {
        message: "A module can have at most 100 links",
      });
    }
    await assertUrlAvailable(tx, moduleId, normalized);

    const [link] = await tx
      .insert(moduleLinkTable)
      .values({
        moduleId,
        url: normalized,
        title: requireLinkTitle(title),
        createdBy: userId,
      })
      .returning();
    if (!link) {
      throw new HTTPException(500, { message: "Failed to create the link" });
    }
    return link;
  });
}

export async function updateModuleLink({
  moduleId,
  linkId,
  userId,
  url,
  title,
}: {
  moduleId: string;
  linkId: string;
  userId: string;
  url?: string;
  title?: string | null;
}) {
  const normalized = url === undefined ? undefined : requireLinkUrl(url);

  return writeLink(moduleId, userId, "updated", async (tx) => {
    const link = await requireLink(tx, moduleId, linkId);
    const values = {
      url: normalized,
      title: title === undefined ? undefined : requireLinkTitle(title),
    };
    if (values.url !== undefined && values.url !== link.url) {
      await assertUrlAvailable(tx, moduleId, values.url, linkId);
    }
    if (values.url === undefined && values.title === undefined) return link;

    const [updated] = await tx
      .update(moduleLinkTable)
      .set(values)
      .where(eq(moduleLinkTable.id, linkId))
      .returning();
    return updated ?? link;
  });
}

export async function deleteModuleLink({
  moduleId,
  linkId,
  userId,
}: {
  moduleId: string;
  linkId: string;
  userId: string;
}) {
  return writeLink(moduleId, userId, "deleted", async (tx) => {
    await requireLink(tx, moduleId, linkId);
    await tx.delete(moduleLinkTable).where(eq(moduleLinkTable.id, linkId));
    return { id: linkId };
  });
}
