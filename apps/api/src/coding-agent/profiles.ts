import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { codingAgentProfileTable } from "../database/schema";

// Coding-agent profiles are issue templates: a mention line and an optional
// assignee, sent through the project's own GitHub or Gitea credentials.
// Nothing here holds or needs a third-party AI key.

export type CodingAgentProvider = "github" | "gitea";

export const BUILTIN_PROFILES = [
  {
    builtin: "claude_code",
    name: "Claude Code (GitHub Action)",
    mention: "@claude",
    assignee: null,
  },
  {
    builtin: "copilot",
    name: "GitHub Copilot coding agent",
    mention: "",
    assignee: "Copilot",
  },
  { builtin: "codex", name: "Codex", mention: "@codex", assignee: null },
] as const;

export type BuiltinProfileKey = (typeof BUILTIN_PROFILES)[number]["builtin"];

export type CodingAgentProfile = typeof codingAgentProfileTable.$inferSelect;

/** Adds the built-in profiles a workspace lacks (idempotent). */
async function seedBuiltins(workspaceId: string): Promise<void> {
  await db
    .insert(codingAgentProfileTable)
    .values(
      BUILTIN_PROFILES.map((profile) => ({
        workspaceId,
        builtin: profile.builtin,
        name: profile.name,
        mention: profile.mention,
        assignee: profile.assignee,
      })),
    )
    .onConflictDoNothing({
      target: [
        codingAgentProfileTable.workspaceId,
        codingAgentProfileTable.builtin,
      ],
    });
}

/** Every profile of the workspace: built-ins first, then custom ones. */
export async function listProfiles(
  workspaceId: string,
): Promise<CodingAgentProfile[]> {
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(codingAgentProfileTable)
    .where(
      and(
        eq(codingAgentProfileTable.workspaceId, workspaceId),
        sql`${codingAgentProfileTable.builtin} is not null`,
      ),
    );
  if (count < BUILTIN_PROFILES.length) await seedBuiltins(workspaceId);
  return db
    .select()
    .from(codingAgentProfileTable)
    .where(eq(codingAgentProfileTable.workspaceId, workspaceId))
    .orderBy(
      sql`case ${codingAgentProfileTable.builtin} when 'claude_code' then 0 when 'copilot' then 1 when 'codex' then 2 else 3 end`,
      asc(codingAgentProfileTable.createdAt),
      asc(codingAgentProfileTable.name),
    );
}

export async function getProfile(
  workspaceId: string,
  profileId: string,
): Promise<CodingAgentProfile> {
  const [profile] = await db
    .select()
    .from(codingAgentProfileTable)
    .where(
      and(
        eq(codingAgentProfileTable.id, profileId),
        eq(codingAgentProfileTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!profile) {
    throw new HTTPException(404, { message: "Coding agent profile not found" });
  }
  return profile;
}

/** Whether a profile can drive an issue on this forge. */
export function profileWorksOn(
  profile: Pick<CodingAgentProfile, "mention" | "assignee">,
  provider: CodingAgentProvider,
): boolean {
  if (profile.mention.trim()) return true;
  // Gitea gets mention templates only; an assignee alone does nothing there.
  return provider === "github" && Boolean(profile.assignee?.trim());
}

type ProfileInput = {
  name?: string;
  mention?: string;
  assignee?: string | null;
  enabled?: boolean;
};

function assertUsable(mention: string, assignee: string | null) {
  if (!mention.trim() && !assignee?.trim()) {
    throw new HTTPException(400, {
      message: "A profile needs a mention or an assignee",
    });
  }
}

export async function createProfile(
  workspaceId: string,
  input: Required<Pick<ProfileInput, "name">> & ProfileInput,
): Promise<CodingAgentProfile> {
  const mention = input.mention?.trim() ?? "";
  const assignee = input.assignee?.trim() || null;
  assertUsable(mention, assignee);
  const [profile] = await db
    .insert(codingAgentProfileTable)
    .values({
      workspaceId,
      name: input.name.trim(),
      mention,
      assignee,
      enabled: input.enabled ?? true,
    })
    .returning();
  if (!profile) throw new Error("Failed to create coding agent profile");
  return profile;
}

export async function updateProfile(
  workspaceId: string,
  profileId: string,
  input: ProfileInput,
): Promise<{ before: CodingAgentProfile; after: CodingAgentProfile }> {
  const before = await getProfile(workspaceId, profileId);
  const mention =
    input.mention !== undefined ? input.mention.trim() : before.mention;
  const assignee =
    input.assignee !== undefined
      ? input.assignee?.trim() || null
      : before.assignee;
  assertUsable(mention, assignee);
  const [after] = await db
    .update(codingAgentProfileTable)
    .set({
      name: input.name !== undefined ? input.name.trim() : before.name,
      mention,
      assignee,
      enabled: input.enabled ?? before.enabled,
    })
    .where(eq(codingAgentProfileTable.id, profileId))
    .returning();
  if (!after) throw new Error("Failed to update coding agent profile");
  return { before, after };
}

/** Custom profiles only; built-ins can be turned off instead. */
export async function deleteProfile(
  workspaceId: string,
  profileId: string,
): Promise<CodingAgentProfile> {
  const profile = await getProfile(workspaceId, profileId);
  if (profile.builtin) {
    throw new HTTPException(400, {
      message: "Built-in profiles can be turned off but not deleted",
    });
  }
  await db
    .delete(codingAgentProfileTable)
    .where(
      and(
        eq(codingAgentProfileTable.id, profileId),
        isNull(codingAgentProfileTable.builtin),
      ),
    );
  return profile;
}

/**
 * The mention line of an issue. A bare handle ("@claude") gets a short
 * request after it; a longer template is used as written, with `{task}` and
 * `{branch}` filled in.
 */
export function renderMention(
  mention: string,
  values: { task: string; branch: string },
): string {
  const text = mention.trim();
  if (!text) return "";
  if (/^@[\w.[\]-]+$/.test(text)) {
    return `${text} Please work on this issue and open a pull request that references it.`;
  }
  return text
    .replaceAll("{task}", values.task)
    .replaceAll("{branch}", values.branch);
}
