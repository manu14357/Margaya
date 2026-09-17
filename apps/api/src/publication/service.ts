import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  projectPublicationTable,
  projectTable,
  userTable,
} from "../database/schema";
import { publishEvent } from "../events";
import { isUniqueViolation } from "../module/controllers/shared";
import { publicBoardInstanceState } from "../public-board/instance-state";
import type { Transaction } from "../task/assignee-writes";
import {
  applySettingsPatch,
  DEFAULT_PUBLICATION_SETTINGS,
  type PublicationSettings,
  type PublicationSettingsPatch,
  SETTINGS_MESSAGES,
  settingsOf,
} from "./settings";
import { generateLinkToken, publicBoardPath } from "./token";

// Publishing (B12 §3.3). Every write locks the project row and keeps
// `project.is_public` (the mirror older readers use) in the same transaction.

export const PUBLICATION_MESSAGES = {
  boardsOff: "Public boards are turned off on this server",
  archived: "Archived projects can't be published",
} as const;

const TOKEN_ATTEMPTS = 3;
const TOKEN_CONSTRAINT = "project_publication_link_token_unique";

export type PublicationRow = typeof projectPublicationTable.$inferSelect;

type LockedProject = {
  id: string;
  workspaceId: string;
  archivedAt: Date | null;
  intakeEnabled: boolean;
  isPublic: boolean | null;
};

type Actor = { projectId: string; workspaceId: string; userId: string };

type PendingEvent = { name: string; data: Record<string, unknown> };

async function lockProject(
  tx: Transaction,
  projectId: string,
): Promise<LockedProject> {
  const [project] = await tx
    .select({
      id: projectTable.id,
      workspaceId: projectTable.workspaceId,
      archivedAt: projectTable.archivedAt,
      intakeEnabled: projectTable.intakeEnabled,
      isPublic: projectTable.isPublic,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .for("update");
  if (!project) throw new HTTPException(404, { message: "Project not found" });
  return project;
}

async function findPublication(tx: Transaction | typeof db, projectId: string) {
  const [row] = await tx
    .select()
    .from(projectPublicationTable)
    .where(eq(projectPublicationTable.projectId, projectId))
    .limit(1);
  return row ?? null;
}

/** Runs a write that takes a fresh token, retrying a rare token clash. */
async function withFreshToken<T>(
  tx: Transaction,
  write: (savepoint: Transaction, token: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // A savepoint, so a clash doesn't abort the outer transaction.
      return await tx.transaction((savepoint) =>
        write(savepoint, generateLinkToken()),
      );
    } catch (error) {
      if (
        attempt >= TOKEN_ATTEMPTS ||
        !isUniqueViolation(error, TOKEN_CONSTRAINT)
      ) {
        throw error;
      }
    }
  }
}

async function createPublication(
  tx: Transaction,
  projectId: string,
  settings: PublicationSettings,
): Promise<PublicationRow> {
  return withFreshToken(tx, async (savepoint, linkToken) => {
    const [row] = await savepoint
      .insert(projectPublicationTable)
      .values({ projectId, linkToken, ...settings })
      .returning();
    if (!row) throw new Error("Failed to create the publication");
    return row;
  });
}

/**
 * A board first published through the legacy `isPublic` flag behaves like a
 * backfilled one (K2): its link token is the project id, which is the link
 * legacy clients (MCP's update_project, older web builds) share, and it
 * shows assignees as boards did before publications existed.
 */
async function createLegacyPublication(
  tx: Transaction,
  projectId: string,
): Promise<PublicationRow> {
  const [row] = await tx
    .insert(projectPublicationTable)
    .values({
      projectId,
      linkToken: projectId,
      ...DEFAULT_PUBLICATION_SETTINGS,
      showAssignees: true,
    })
    .returning();
  if (!row) throw new Error("Failed to create the publication");
  return row;
}

async function setMirror(
  tx: Transaction,
  project: LockedProject,
  value: boolean,
) {
  if ((project.isPublic ?? false) === value) return;
  await tx
    .update(projectTable)
    .set({ isPublic: value })
    .where(eq(projectTable.id, project.id));
}

async function publishAll(events: PendingEvent[]) {
  for (const event of events) await publishEvent(event.name, event.data);
}

function changedEvent(actor: Actor, changes: string[]): PendingEvent[] {
  return changes.length > 0
    ? [{ name: "publication.updated", data: { ...actor, changes } }]
    : [];
}

/**
 * Publishes (or keeps publishing) the project, applying optional settings
 * first. A no-op publish answers the row without a `published` event.
 */
export async function publishProject(
  actor: Actor,
  settings?: PublicationSettingsPatch,
): Promise<PublicationRow> {
  const instance = await publicBoardInstanceState();
  if (!instance.publicBoards) {
    throw new HTTPException(409, { message: PUBLICATION_MESSAGES.boardsOff });
  }

  const { row, events } = await db.transaction(async (tx) => {
    const project = await lockProject(tx, actor.projectId);
    if (project.archivedAt) {
      throw new HTTPException(409, { message: PUBLICATION_MESSAGES.archived });
    }
    const existing =
      (await findPublication(tx, actor.projectId)) ??
      (await createPublication(
        tx,
        actor.projectId,
        DEFAULT_PUBLICATION_SETTINGS,
      ));

    const { next, changes } =
      settings && Object.keys(settings).length > 0
        ? applySettingsPatch(settingsOf(existing), settings, project)
        : { next: settingsOf(existing), changes: [] };
    const publishing = existing.publishedAt === null;

    const [updated] =
      publishing || changes.length > 0
        ? await tx
            .update(projectPublicationTable)
            .set({
              ...next,
              ...(publishing
                ? { publishedAt: new Date(), publishedBy: actor.userId }
                : {}),
            })
            .where(eq(projectPublicationTable.id, existing.id))
            .returning()
        : [existing];
    await setMirror(tx, project, true);

    const pending: PendingEvent[] = [
      ...(publishing ? [{ name: "publication.published", data: actor }] : []),
      ...changedEvent(actor, changes),
    ];
    return { row: updated ?? existing, events: pending };
  });

  await publishAll(events);
  return row;
}

/** Unpublishes; the row, token, settings and blocks are all kept. */
export async function unpublishProject(
  actor: Actor,
): Promise<PublicationRow | null> {
  const { row, events } = await db.transaction(async (tx) => {
    const project = await lockProject(tx, actor.projectId);
    const existing = await findPublication(tx, actor.projectId);
    await setMirror(tx, project, false);
    if (!existing || existing.publishedAt === null) {
      return { row: existing, events: [] as PendingEvent[] };
    }
    const [updated] = await tx
      .update(projectPublicationTable)
      .set({ publishedAt: null })
      .where(eq(projectPublicationTable.id, existing.id))
      .returning();
    return {
      row: updated ?? existing,
      events: [{ name: "publication.unpublished", data: actor }],
    };
  });
  await publishAll(events);
  return row;
}

/** Changes settings, published or not (prepared before publishing). */
export async function updatePublicationSettings(
  actor: Actor,
  patch: PublicationSettingsPatch,
): Promise<PublicationRow> {
  if (Object.values(patch).every((value) => value === undefined)) {
    throw new HTTPException(400, { message: SETTINGS_MESSAGES.empty });
  }
  const { row, events } = await db.transaction(async (tx) => {
    const project = await lockProject(tx, actor.projectId);
    const existing =
      (await findPublication(tx, actor.projectId)) ??
      (await createPublication(
        tx,
        actor.projectId,
        DEFAULT_PUBLICATION_SETTINGS,
      ));
    const { next, changes } = applySettingsPatch(
      settingsOf(existing),
      patch,
      project,
    );
    if (changes.length === 0) return { row: existing, events: [] };
    const [updated] = await tx
      .update(projectPublicationTable)
      .set(next)
      .where(eq(projectPublicationTable.id, existing.id))
      .returning();
    return { row: updated ?? existing, events: changedEvent(actor, changes) };
  });
  await publishAll(events);
  return row;
}

/** Issues a new link; the old one stops working on the next request. */
export async function rotatePublicationLink(
  actor: Actor,
): Promise<PublicationRow> {
  const row = await db.transaction(async (tx) => {
    await lockProject(tx, actor.projectId);
    const existing = await findPublication(tx, actor.projectId);
    if (!existing) {
      return createPublication(
        tx,
        actor.projectId,
        DEFAULT_PUBLICATION_SETTINGS,
      );
    }
    return withFreshToken(tx, async (savepoint, linkToken) => {
      const [updated] = await savepoint
        .update(projectPublicationTable)
        .set({ linkToken })
        .where(eq(projectPublicationTable.id, existing.id))
        .returning();
      return updated ?? existing;
    });
  });
  // The event names no token.
  await publishEvent("publication.link_rotated", actor);
  return row;
}

/**
 * The legacy `PUT /project/{id}` with `isPublic` (MCP's update_project):
 * publishes or unpublishes inside the caller's transaction, keeping the
 * stored settings. Returns the event to publish after the commit, if any.
 */
export async function applyLegacyPublicState(
  tx: Transaction,
  actor: Actor,
  isPublic: boolean,
): Promise<PendingEvent | null> {
  const project = await lockProject(tx, actor.projectId);
  const existing = await findPublication(tx, actor.projectId);
  if (isPublic) {
    const instance = await publicBoardInstanceState();
    if (!instance.publicBoards) {
      throw new HTTPException(409, { message: PUBLICATION_MESSAGES.boardsOff });
    }
    if (project.archivedAt) {
      throw new HTTPException(409, { message: PUBLICATION_MESSAGES.archived });
    }
    const row =
      existing ?? (await createLegacyPublication(tx, actor.projectId));
    await setMirror(tx, project, true);
    if (row.publishedAt !== null) return null;
    await tx
      .update(projectPublicationTable)
      .set({ publishedAt: new Date(), publishedBy: actor.userId || null })
      .where(eq(projectPublicationTable.id, row.id));
    return { name: "publication.published", data: actor };
  }
  await setMirror(tx, project, false);
  if (!existing || existing.publishedAt === null) return null;
  await tx
    .update(projectPublicationTable)
    .set({ publishedAt: null })
    .where(eq(projectPublicationTable.id, existing.id));
  return { name: "publication.unpublished", data: actor };
}

export async function publishPendingEvent(event: PendingEvent | null) {
  if (event) await publishEvent(event.name, event.data);
}

/** The `ProjectPublication` response for a project. */
export async function publicationView(
  projectId: string,
  { canManage }: { canManage: boolean },
) {
  const [project] = await db
    .select({ intakeEnabled: projectTable.intakeEnabled })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project) throw new HTTPException(404, { message: "Project not found" });
  const row = await findPublication(db, projectId);
  const instance = await publicBoardInstanceState();

  let publishedBy: { id: string; name: string; image: string | null } | null =
    null;
  if (row?.publishedBy) {
    const [user] = await db
      .select({
        id: userTable.id,
        name: userTable.name,
        image: userTable.image,
      })
      .from(userTable)
      .where(eq(userTable.id, row.publishedBy))
      .limit(1);
    publishedBy = user ?? null;
  }

  const settings = row ? settingsOf(row) : DEFAULT_PUBLICATION_SETTINGS;
  return {
    projectId,
    published: Boolean(row?.publishedAt),
    publishedAt: row?.publishedAt ?? null,
    publishedBy,
    linkToken: row?.linkToken ?? null,
    path: row ? publicBoardPath(row.linkToken) : null,
    ...settings,
    availability: {
      publicBoards: instance.publicBoards,
      participation: instance.participation,
      requests: project.intakeEnabled,
      guests: instance.guestAccessActive,
    },
    canManage,
    updatedAt: row?.updatedAt ?? null,
  };
}
