import { and, eq, isNull } from "drizzle-orm";
import type { Context, Next } from "hono";
import db from "../database";
import { projectTable } from "../database/schema";
import { canSeeProject } from "../project/visibility";
import {
  requireWorkspacePermission,
  workspacePermissionChecker,
} from "../utils/require-workspace-permission";
import { AiError } from "./errors";
import {
  type AiInstanceConfig,
  getAiInstanceConfig,
  hasLocalEndpoint,
  speechConfigured,
  webSearchConfigured,
} from "./instance-config";
import { routeAiCall } from "./router";
import {
  DEFAULT_WORKSPACE_AI_POLICY,
  loadWorkspaceAi,
} from "./workspace-settings";

// Who may use AI where. Four switches must all be on: the instance
// (ai.enabled), the workspace (workspace_ai_setting.enabled), the project
// (project.ai_enabled, for project-scoped features) and the caller's
// permission (ai:use; ai:manage for settings and usage).

/** ai:use; place after `workspaceAccess`. */
export const requireAiUse = requireWorkspacePermission({ ai: ["use"] });

/** ai:manage; place after `workspaceAccess`. */
export const requireAiManage = requireWorkspacePermission({ ai: ["manage"] });

/** 403 AI_DISABLED unless AI is on for the instance and the workspace. */
export async function assertAiEnabled(workspaceId: string): Promise<void> {
  if (!getAiInstanceConfig().enabled) {
    throw new AiError("AI_DISABLED", "AI is turned off on this server");
  }
  const { policy } = await loadWorkspaceAi(workspaceId);
  if (!policy.enabled) {
    throw new AiError("AI_DISABLED", "AI is turned off for this workspace");
  }
}

/**
 * Route middleware for AI features: AI on for the instance and the
 * workspace. Place after `workspaceAccess` and `requireAiUse`.
 */
export function requireAiEnabled() {
  return async (c: Context, next: Next) => {
    await assertAiEnabled(c.get("workspaceId") as string);
    return next();
  };
}

/** Whether some route can carry ordinary (private) workspace data. */
export function instanceAiConfigured(config: AiInstanceConfig): boolean {
  if (config.localOnly) return hasLocalEndpoint(config);
  const route = routeAiCall({
    instance: config,
    workspace: { ...DEFAULT_WORKSPACE_AI_POLICY, enabled: true },
    workspaceApiKey: null,
    dataTier: "private",
    tier: "balanced",
  });
  return route.ok;
}

export type AiAvailability = {
  /** Every switch is on and the caller has ai:use: show AI features. */
  available: boolean;
  instanceEnabled: boolean;
  /** A provider is set up for ordinary workspace data. */
  configured: boolean;
  workspaceEnabled: boolean;
  /** The project's switch; null when no project was asked about. */
  projectEnabled: boolean | null;
  canUse: boolean;
  canManage: boolean;
  /** Where ordinary data goes: "cloud" provider or "local" endpoint. */
  destination: "cloud" | "local" | null;
  provider: string | null;
  zeroRetention: boolean;
  requireApprovalForWrites: boolean;
  autoTranslateComments: boolean;
  /** The model ordinary calls use (configured name); null when none. */
  model: string | null;
  features: {
    webSearch: boolean;
    storeConversations: boolean;
    autopilot: boolean;
    speech: boolean;
    showReasoning: boolean;
  };
};

/** What the web needs to show or hide AI (useAiAvailability). */
export async function aiAvailability(
  c: Context,
  projectId: string | null,
): Promise<AiAvailability> {
  const workspaceId = c.get("workspaceId") as string;
  const userId = c.get("userId") as string;
  const config = getAiInstanceConfig();
  const [workspace, can] = await Promise.all([
    loadWorkspaceAi(workspaceId),
    workspacePermissionChecker(c),
  ]);
  const policy = workspace.policy;
  let projectEnabled: boolean | null = null;
  if (projectId) {
    const [project] = await db
      .select({ aiEnabled: projectTable.aiEnabled })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, projectId),
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
        ),
      )
      .limit(1);
    // A project the caller can't see answers like a missing one: off.
    projectEnabled = Boolean(
      project?.aiEnabled && (await canSeeProject(userId, projectId)),
    );
  }
  const instanceEnabled = config.enabled;
  const route = instanceEnabled
    ? routeAiCall({
        instance: config,
        workspace: policy,
        workspaceApiKey: workspace.apiKey,
        dataTier: "private",
        tier: "balanced",
      })
    : null;
  const canUse = can({ ai: ["use"] });
  const canManage = can({ ai: ["manage"] });
  const configured = Boolean(route?.ok);
  return {
    available:
      instanceEnabled &&
      configured &&
      policy.enabled &&
      projectEnabled !== false &&
      canUse,
    instanceEnabled,
    configured,
    workspaceEnabled: policy.enabled,
    projectEnabled,
    canUse,
    canManage,
    destination: route?.ok ? route.destination.kind : null,
    provider: route?.ok ? route.destination.provider : null,
    zeroRetention: config.zeroRetention,
    requireApprovalForWrites: policy.requireApprovalForWrites,
    autoTranslateComments: policy.autoTranslateComments,
    model: route?.ok ? route.destination.model : null,
    features: {
      webSearch: webSearchConfigured(config) && policy.webSearchEnabled,
      storeConversations: policy.storeConversations,
      autopilot: policy.allowAutopilot,
      speech: speechConfigured(config),
      showReasoning: config.showReasoning,
    },
  };
}
