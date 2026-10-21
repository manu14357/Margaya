import { and, eq, or, type SQL } from "drizzle-orm";
import db from "../database";
import { aiSkillTable } from "../database/schema";

// Loading skills for prompts (Ask `skillId`, agents' skill_ids). A skill's
// prompt is the person's own instruction, so it goes into the user turn,
// never into the system prompt.

export const MAX_SKILL_NAME_CHARS = 80;
export const MAX_SKILL_DESCRIPTION_CHARS = 300;
export const MAX_SKILL_PROMPT_CHARS = 4_000;
export const MAX_SKILLS_PER_WORKSPACE = 200;
export const SKILL_NOT_FOUND = "Skill not found";

/** Shared skills and the person's own private ones. */
export function skillVisibleTo(userId: string): SQL {
  return or(
    eq(aiSkillTable.shared, true),
    eq(aiSkillTable.createdBy, userId),
  ) as SQL;
}

export type LoadedSkill = { id: string; name: string; prompt: string };

/**
 * A skill of the workspace the person may use, or null (unknown, another
 * workspace's, or someone else's private skill).
 */
export async function loadSkillFor(input: {
  workspaceId: string;
  userId: string;
  skillId: string;
}): Promise<LoadedSkill | null> {
  const [row] = await db
    .select({
      id: aiSkillTable.id,
      name: aiSkillTable.name,
      prompt: aiSkillTable.prompt,
    })
    .from(aiSkillTable)
    .where(
      and(
        eq(aiSkillTable.id, input.skillId),
        eq(aiSkillTable.workspaceId, input.workspaceId),
        skillVisibleTo(input.userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The skill as the user-turn block that precedes the question. */
export function skillInstructions(skill: Pick<LoadedSkill, "name" | "prompt">) {
  return `Instructions from the user for this question (saved skill "${skill.name.replace(/["\r\n]+/g, " ")}"):\n${skill.prompt}`;
}
