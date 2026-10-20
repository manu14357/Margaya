import { eq } from "drizzle-orm";
import db from "../database";
import { userTable, workspaceAiSettingTable } from "../database/schema";
import { openSecret, sealSecret } from "../utils/secret-box";

// A workspace's AI opt-in and policy (workspace_ai_setting). No row means
// the defaults below: AI off. An own key is sealed with its own purpose, so
// its key differs from instance secrets, and is never returned.

const KEY_PURPOSE = "ai-workspace-key";

export type WorkspaceKeyProvider = "anthropic" | "openai_compatible";

export type WorkspaceAiPolicy = {
  enabled: boolean;
  /** The provider the own key is for; null when there is no own key. */
  provider: WorkspaceKeyProvider | null;
  hasKey: boolean;
  keyLast4: string | null;
  /** Unreadable after AUTH_SECRET rotated; the admin enters it again. */
  keyUnreadable: boolean;
  monthlyCapMicros: number | null;
  userDailyCapTokens: number | null;
  requireApprovalForWrites: boolean;
  includeRestricted: boolean;
  localOnly: boolean;
  redactPii: boolean;
  embeddingsEnabled: boolean;
  /** Translate comments in another language for each reader (B8). */
  autoTranslateComments: boolean;
  /** Ask may search the web (when the instance has a search provider). */
  webSearchEnabled: boolean;
  /** Ask conversations may be kept on the server (opt-in). */
  storeConversations: boolean;
  /** Chat may apply AI changes without a review step. */
  allowAutopilot: boolean;
  updatedAt: Date | null;
  updatedBy: { id: string; name: string } | null;
};

export const DEFAULT_WORKSPACE_AI_POLICY: WorkspaceAiPolicy = {
  enabled: false,
  provider: null,
  hasKey: false,
  keyLast4: null,
  keyUnreadable: false,
  monthlyCapMicros: null,
  userDailyCapTokens: null,
  requireApprovalForWrites: false,
  includeRestricted: false,
  localOnly: false,
  redactPii: false,
  embeddingsEnabled: false,
  autoTranslateComments: false,
  webSearchEnabled: false,
  storeConversations: false,
  allowAutopilot: false,
  updatedAt: null,
  updatedBy: null,
};

function openKey(sealed: string | null): string | null {
  if (!sealed) return null;
  try {
    return openSecret(KEY_PURPOSE, sealed);
  } catch {
    return null;
  }
}

async function loadRow(workspaceId: string) {
  const [row] = await db
    .select({
      setting: workspaceAiSettingTable,
      updatedByName: userTable.name,
    })
    .from(workspaceAiSettingTable)
    .leftJoin(userTable, eq(userTable.id, workspaceAiSettingTable.updatedBy))
    .where(eq(workspaceAiSettingTable.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

/** The policy plus the opened key, for the gateway only. */
export async function loadWorkspaceAi(
  workspaceId: string,
): Promise<{ policy: WorkspaceAiPolicy; apiKey: string | null }> {
  const row = await loadRow(workspaceId);
  if (!row) return { policy: DEFAULT_WORKSPACE_AI_POLICY, apiKey: null };
  const s = row.setting;
  const apiKey = openKey(s.secret);
  return {
    apiKey,
    policy: {
      enabled: s.enabled,
      provider: s.secret ? (s.provider ?? null) : null,
      hasKey: Boolean(s.secret),
      keyLast4: s.secret ? s.secretLast4 : null,
      keyUnreadable: Boolean(s.secret) && apiKey === null,
      monthlyCapMicros: s.monthlyCapMicros,
      userDailyCapTokens: s.userDailyCapTokens,
      requireApprovalForWrites: s.requireApprovalForWrites,
      includeRestricted: s.includeRestricted,
      localOnly: s.localOnly,
      redactPii: s.redactPii,
      embeddingsEnabled: s.embeddingsEnabled,
      autoTranslateComments: s.autoTranslateComments,
      webSearchEnabled: s.webSearchEnabled,
      storeConversations: s.storeConversations,
      allowAutopilot: s.allowAutopilot,
      updatedAt: s.updatedAt,
      updatedBy:
        s.updatedBy && row.updatedByName !== null
          ? { id: s.updatedBy, name: row.updatedByName }
          : null,
    },
  };
}

/** The policy without the key. */
export async function loadWorkspaceAiPolicy(
  workspaceId: string,
): Promise<WorkspaceAiPolicy> {
  return (await loadWorkspaceAi(workspaceId)).policy;
}

export type WorkspaceAiPatch = {
  enabled?: boolean;
  monthlyCapMicros?: number | null;
  userDailyCapTokens?: number | null;
  requireApprovalForWrites?: boolean;
  includeRestricted?: boolean;
  localOnly?: boolean;
  redactPii?: boolean;
  embeddingsEnabled?: boolean;
  autoTranslateComments?: boolean;
  webSearchEnabled?: boolean;
  storeConversations?: boolean;
  allowAutopilot?: boolean;
  /** A new own key with its provider, or null to remove the key. */
  key?: { provider: WorkspaceKeyProvider; apiKey: string } | null;
};

/** Applies a patch (creating the row on first save). */
export async function saveWorkspaceAiSettings(
  workspaceId: string,
  patch: WorkspaceAiPatch,
  userId: string,
): Promise<void> {
  const { key, ...fields } = patch;
  const values: Partial<typeof workspaceAiSettingTable.$inferInsert> = {
    ...fields,
    updatedBy: userId,
  };
  if (key === null) {
    values.secret = null;
    values.secretLast4 = null;
    values.provider = null;
  } else if (key) {
    const trimmed = key.apiKey.trim();
    values.secret = sealSecret(KEY_PURPOSE, trimmed);
    values.secretLast4 = trimmed.slice(-4);
    values.provider = key.provider;
  }
  await db
    .insert(workspaceAiSettingTable)
    .values({ workspaceId, ...values })
    .onConflictDoUpdate({
      target: workspaceAiSettingTable.workspaceId,
      set: { ...values, updatedAt: new Date() },
    });
}
