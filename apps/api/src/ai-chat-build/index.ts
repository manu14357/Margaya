import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { requireAiEnabled, requireAiUse } from "../ai/access";
import { isAiError } from "../ai/errors";
import { aiErrorResponse } from "../ai/sse";
import { loadWorkspaceAiPolicy } from "../ai/workspace-settings";
import { internalApi } from "../ai-build/dispatch";
import db from "../database";
import { workspaceAiSettingTable } from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { applyActions, undoAction } from "./executor";
import { type PlanOutcome, planBuild, planScope } from "./planner";
import {
  applyResponseSchema,
  planResponseSchema,
  undoResponseSchema,
} from "./response";
import {
  applyBody,
  type ChatBuildAction,
  type PlanBody,
  planBody,
  undoBody,
} from "./schema";
import { mentionedTaskRefs, validateActions } from "./validate";

// Build mode in chat (plan → review → apply → undo). The plan is only a
// proposal; apply re-checks every action and runs it through the ordinary
// routes as the caller. Autopilot applies a clean plan right away, only
// where the workspace allows it.

const TAGS = ["AI"];
const json = <T>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const planRoute = createRoute({
  method: "post",
  operationId: "aiChatBuildPlan",
  path: "/plan",
  tags: TAGS,
  summary: "Plan changes from a chat request",
  description: `Turns a request such as "create a project NX-7 with Elena as lead and three tasks" into actions to review: create_project, create_task, update_task, set_status, assign, add_comment, create_cycle, add_to_cycle, create_module, add_to_module, create_page, link_tasks, create_label, delete_task and run_agent, at most 50. Actions may point at things created earlier in the plan through temp refs. Names are resolved to ids (members, tasks by key, statuses, cycles, modules, agents) within what the caller's AI may read, and each action is checked against the caller's permissions; one that can't be applied carries a problem. An ambiguous request gets a question with options instead. Nothing changes, unless autopilot is true and the workspace allows Autopilot: then a plan without problems, questions or destructive actions is applied at once and the results come back too. Returns JSON; with Accept: text/event-stream it streams Server-Sent Events instead: context (what the plan is made from: fact counts, the items read in full with titles and links, memory notes, earlier turns), reasoning {text} while the model thinks (text only when the instance shows reasoning), then done with the plan, or error {code, message}.`,
  middleware: [
    workspaceAccess.fromBody(),
    requireAiUse,
    requireAiEnabled(),
  ] as const,
  request: { body: json(planBody) },
  responses: {
    200: {
      description: "The plan (JSON), or the planning stream (SSE)",
      content: {
        "application/json": { schema: planResponseSchema },
        "text/event-stream": {
          schema: z.string().openapi({
            description:
              "Events: context {facts: {projects, tasks, members, cycles}, items: [{kind, title, url}], memoryNotes, earlierTurns}, reasoning {text}, done {the plan}, error {code, message}.",
          }),
        },
      },
    },
    400: errorResponse("Invalid body"),
    403: aiErrorResponse(
      "AI off (AI_DISABLED) or route blocked; or plain-text permission errors",
    ),
    404: errorResponse("Project not found"),
    409: aiErrorResponse("No AI provider is set up (AI_NOT_CONFIGURED)"),
    422: aiErrorResponse("The model declined (AI_REFUSED)"),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
    502: aiErrorResponse("AI_PROVIDER_ERROR"),
  },
});

const applyRoute = createRoute({
  method: "post",
  operationId: "aiChatBuildApply",
  path: "/apply",
  tags: TAGS,
  summary: "Apply reviewed chat actions",
  description:
    "Applies the actions the person confirmed (possibly edited or with some removed), in order, through the ordinary routes with the caller's own credentials, so permissions, events, activity, realtime updates and webhooks are exactly as if they had made each change by hand. Every action is checked again first. An action with a problem, an unconfirmed destructive action and any action that depends on one that failed are skipped; the others still run. Each applied action returns a link and an undo token valid for an hour. Makes no model call.",
  middleware: [
    workspaceAccess.fromBody(),
    requireAiUse,
    requireAiEnabled(),
  ] as const,
  request: { body: json(applyBody) },
  responses: {
    200: jsonResponse("One result per action, in order", applyResponseSchema),
    400: errorResponse("Invalid body"),
    403: aiErrorResponse("AI off (AI_DISABLED); or no ai:use"),
  },
});

const undoRoute = createRoute({
  method: "post",
  operationId: "aiChatBuildUndo",
  path: "/undo",
  tags: TAGS,
  summary: "Undo one applied chat action",
  description:
    "Reverts one action applied from chat with its undo token, through the ordinary routes with the caller's own rights: what it created is deleted (or archived when the caller may not delete it; pages are archived), changed fields, status and assignees get their old values, cycle and module additions are taken out, and a deleted task is restored from the trash. Only the person who applied it can undo it, within an hour, once.",
  middleware: [workspaceAccess.fromBody()] as const,
  request: { body: json(undoBody) },
  responses: {
    200: jsonResponse("Undone", undoResponseSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("The caller may no longer make this change"),
    404: errorResponse("Unknown token, or what it changed is gone"),
    409: errorResponse("Already undone"),
    410: errorResponse("Undo has expired"),
  },
});

/** Autopilot needs the workspace switch, and no approval rule for AI writes. */
async function autopilotAllowed(workspaceId: string): Promise<boolean> {
  const [[row], policy] = await Promise.all([
    db
      .select({ allowAutopilot: workspaceAiSettingTable.allowAutopilot })
      .from(workspaceAiSettingTable)
      .where(eq(workspaceAiSettingTable.workspaceId, workspaceId))
      .limit(1),
    loadWorkspaceAiPolicy(workspaceId),
  ]);
  return Boolean(row?.allowAutopilot) && !policy.requireApprovalForWrites;
}

async function applyChecked(
  c: Context,
  actions: readonly unknown[],
  confirmed: ReadonlySet<string>,
) {
  const { workspaceId, userId, can, facts } = await planScope(c, {
    taskRefs: mentionedTaskRefs(actions),
  });
  const checked = validateActions(actions, {
    facts,
    can,
    source: "client",
  }).actions;
  return applyActions({
    call: internalApi(c),
    workspaceId,
    userId,
    facts,
    actions: checked,
    confirmed,
  });
}

/** The plan, applied at once when Autopilot was asked for and allowed. */
async function withAutopilot(c: Context, body: PlanBody, plan: PlanOutcome) {
  if (!body.autopilot) return plan;
  if (!(await autopilotAllowed(c.get("workspaceId")))) {
    return {
      ...plan,
      autopilot: { applied: false, reason: "AUTOPILOT_OFF" as const },
    };
  }
  const clean =
    plan.status === "proposal" &&
    plan.actions.every(
      (action: ChatBuildAction) =>
        !action.problem && action.risk !== "destructive",
    );
  if (!clean) {
    return {
      ...plan,
      autopilot: { applied: false, reason: "NEEDS_REVIEW" as const },
    };
  }
  const results = await applyChecked(c, plan.actions, new Set());
  return { ...plan, autopilot: { applied: true }, results };
}

function streamError(error: unknown) {
  if (isAiError(error)) return error.toJSON();
  if (error instanceof HTTPException) {
    return { code: `HTTP_${error.status}`, message: error.message };
  }
  console.error("AI chat plan failed:", error);
  return { code: "AI_PROVIDER_ERROR", message: "The AI request failed" };
}

const aiChatBuild = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(planRoute, async (c) => {
    const body = c.req.valid("json");
    // JSON unless a stream is asked for by name: this route answered JSON
    // before it could stream, and its existing callers send no Accept.
    if (!(c.req.header("accept") ?? "").includes("text/event-stream")) {
      return c.json(
        await withAutopilot(c, body, await planBuild(c, body)),
        200,
      );
    }

    c.header("Cache-Control", "no-store");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (sse) => {
      const controller = new AbortController();
      sse.onAbort(() => controller.abort());
      const write = (event: string, data: unknown) =>
        sse.writeSSE({ event, data: JSON.stringify(data) });
      let thinking = false;
      try {
        const plan = await planBuild(c, body, {
          signal: controller.signal,
          onContext: (context) => write("context", context),
          onReasoning: async (text) => {
            // Hidden reasoning: one empty event says the model is thinking.
            if (thinking && !text) return;
            thinking = true;
            await write("reasoning", { text });
          },
        });
        await write("done", await withAutopilot(c, body, plan));
      } catch (error) {
        if (!controller.signal.aborted)
          await write("error", streamError(error));
      }
    }) as never;
  })
  .openapi(applyRoute, async (c) => {
    const body = c.req.valid("json");
    const results = await applyChecked(
      c,
      body.actions,
      new Set(body.confirmDestructive ?? []),
    );
    return c.json({ results }, 200);
  })
  .openapi(undoRoute, async (c) => {
    const body = c.req.valid("json");
    await undoAction({
      call: internalApi(c),
      token: body.undoToken,
      userId: c.get("userId"),
      workspaceId: c.get("workspaceId"),
    });
    return c.json({ ok: true as const }, 200);
  });

export default aiChatBuild;
