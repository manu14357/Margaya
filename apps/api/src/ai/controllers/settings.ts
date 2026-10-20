import { HTTPException } from "hono/http-exception";
import {
  prepareSemanticSearch,
  semanticSettingsChanged,
  workspaceSemanticStatus,
} from "../../ai-memory/lifecycle";
import { recordAudit } from "../../audit-log/record";
import { publishEvent } from "../../events";
import { instanceAiConfigured } from "../access";
import {
  getAiInstanceConfig,
  hasLocalEndpoint,
  webSearchConfigured,
} from "../instance-config";
import { workspaceMonthSpendMicros } from "../usage";
import {
  loadWorkspaceAi,
  saveWorkspaceAiSettings,
  type WorkspaceAiPatch,
} from "../workspace-settings";

// Workspace AI settings (ai:manage). The own key is write-only.

export async function getWorkspaceAiSettings(workspaceId: string) {
  const instance = getAiInstanceConfig();
  const [{ policy }, monthSpendMicros, semantic] = await Promise.all([
    loadWorkspaceAi(workspaceId),
    workspaceMonthSpendMicros(workspaceId),
    workspaceSemanticStatus(workspaceId),
  ]);
  return {
    instance: {
      enabled: instance.enabled,
      configured: instance.enabled && instanceAiConfigured(instance),
      provider: instance.provider,
      localAvailable: hasLocalEndpoint(instance),
      localOnly: instance.localOnly,
      allowWorkspaceKeys: instance.allowWorkspaceKeys,
      restrictedRoute: instance.route.restricted,
      privateRoute: instance.route.private,
      redaction: instance.redaction,
      zeroRetention: instance.zeroRetention,
      webSearchAvailable: webSearchConfigured(instance),
    },
    workspace: {
      enabled: policy.enabled,
      provider: policy.provider,
      hasKey: policy.hasKey,
      keyLast4: policy.keyLast4,
      keyUnreadable: policy.keyUnreadable,
      monthlyCapMicros: policy.monthlyCapMicros,
      userDailyCapTokens: policy.userDailyCapTokens,
      requireApprovalForWrites: policy.requireApprovalForWrites,
      includeRestricted: policy.includeRestricted,
      localOnly: policy.localOnly,
      redactPii: policy.redactPii,
      autoTranslateComments: policy.autoTranslateComments,
      embeddingsEnabled: policy.embeddingsEnabled,
      webSearchEnabled: policy.webSearchEnabled,
      storeConversations: policy.storeConversations,
      allowAutopilot: policy.allowAutopilot,
      updatedAt: policy.updatedAt,
      updatedBy: policy.updatedBy,
    },
    semantic,
    monthSpendMicros,
  };
}

export async function updateWorkspaceAiSettings(
  workspaceId: string,
  userId: string,
  patch: WorkspaceAiPatch,
) {
  const instance = getAiInstanceConfig();
  if (patch.key && !instance.allowWorkspaceKeys) {
    throw new HTTPException(409, {
      message: "This server doesn't allow workspace API keys",
    });
  }
  if (patch.localOnly && !hasLocalEndpoint(instance)) {
    throw new HTTPException(409, {
      message: "This server has no local model for local-only mode",
    });
  }
  if (patch.embeddingsEnabled) {
    // Semantic search needs an embeddings endpoint and pgvector; checking
    // creates the vector store when the extension is available (D1).
    const ready = await prepareSemanticSearch();
    if (!ready.ok) {
      throw new HTTPException(409, {
        message:
          ready.reason === "no_endpoint"
            ? "This server has no embeddings endpoint for semantic search"
            : "pgvector is not available on this server's database",
      });
    }
  }
  const changed = Object.keys(patch).filter(
    (key) => patch[key as keyof WorkspaceAiPatch] !== undefined,
  );
  if (changed.length > 0) {
    await saveWorkspaceAiSettings(workspaceId, patch, userId);
    if (
      patch.embeddingsEnabled !== undefined ||
      patch.includeRestricted !== undefined ||
      patch.localOnly !== undefined ||
      patch.enabled
    ) {
      await semanticSettingsChanged(workspaceId, patch.embeddingsEnabled);
    }
    // Field names only: the key itself never reaches events or the log.
    await publishEvent("ai.settings_updated", {
      workspaceId,
      userId,
      fields: changed,
    });
    await recordAudit({
      workspaceId,
      action: "ai.settings_updated",
      target: { type: "workspace", id: workspaceId, label: null },
      metadata: {
        fields: changed,
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        // Privacy-relevant switches are recorded with their new value.
        ...(patch.webSearchEnabled !== undefined
          ? { webSearchEnabled: patch.webSearchEnabled }
          : {}),
        ...(patch.storeConversations !== undefined
          ? { storeConversations: patch.storeConversations }
          : {}),
        ...(patch.allowAutopilot !== undefined
          ? { allowAutopilot: patch.allowAutopilot }
          : {}),
        ...(patch.key !== undefined
          ? { key: patch.key ? "set" : "removed" }
          : {}),
      },
      actor: { userId },
    });
  }
  return getWorkspaceAiSettings(workspaceId);
}

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;

/** [from, to) in UTC from inclusive YYYY-MM-DD days; default this month. */
export function usageRange(from?: string, to?: string, now = new Date()) {
  const start = from
    ? new Date(`${from}T00:00:00.000Z`)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastDay = to
    ? new Date(`${to}T00:00:00.000Z`)
    : new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
  if (Number.isNaN(start.getTime()) || Number.isNaN(lastDay.getTime())) {
    throw new HTTPException(400, { message: "Invalid date" });
  }
  const end = new Date(lastDay.getTime() + DAY_MS);
  if (end <= start) {
    throw new HTTPException(400, { message: "from must not be after to" });
  }
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new HTTPException(400, {
      message: `Choose at most ${MAX_RANGE_DAYS} days`,
    });
  }
  return { from: start, to: end };
}
