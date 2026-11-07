import { streamSSE } from "hono/streaming";
import { requireAiEnabled, requireAiUse } from "../ai/access";
import { aiErrorResponse, wantsAiStream } from "../ai/sse";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { requireProjectFeature } from "../project/features";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { applyBuild } from "./apply";
import { internalApi } from "./dispatch";
import { checkDuplicates } from "./duplicates";
import { assertBuildTarget, proposeBuild } from "./proposal";
import {
  buildProposalResponseSchema,
  buildReportSchema,
  buildUndoRefusalSchema,
  buildUndoResultSchema,
  duplicateCheckSchema,
} from "./response";
import {
  applyBuildBody,
  buildProposalBody,
  duplicateCheckBody,
  undoBuildBody,
} from "./schema";
import {
  type BuildLedger,
  emptyLedger,
  isBuildUndoRefusal,
  sealBuildUndo,
  undoBuild,
} from "./undo";

// AI build routes (B6): the duplicate check on create, and "talk to build"
// (propose, then apply what the person reviewed, and undo it). Every route
// but undo is hidden behind the AI switches and ai:use; the apply step creates
// each item through the ordinary create routes, so their own permissions
// hold. Undo stays open so a plan can still be reverted if AI was turned off.

const TAGS = ["AI"];
const json = <T>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const duplicateCheckRoute = createRoute({
  method: "post",
  operationId: "aiDuplicateCheck",
  path: "/duplicates",
  tags: TAGS,
  summary: "Check a new task for duplicates",
  description:
    "Re-ranks the full-text duplicate candidates of a draft task (the same ones GET /task/similar/{projectId} lists), plus open tasks close in meaning when the workspace has semantic search on, with a fast model, keeping likely duplicates and related tasks with a short reason. No model call when there are no candidates. Needs ai:use and task:read, AI on for the workspace and the project.",
  middleware: [
    workspaceAccess.fromProject("projectId", {
      notFoundMessage: "Project not found",
    }),
    requireAiUse,
    requireWorkspacePermission({ task: ["read"] }),
    requireAiEnabled(),
    requireProjectFeature("ai", {
      resource: "project",
      key: "projectId",
      in: "body",
    }),
  ] as const,
  request: { body: json(duplicateCheckBody) },
  responses: {
    200: jsonResponse(
      "Likely duplicates and related tasks",
      duplicateCheckSchema,
    ),
    400: errorResponse("Invalid body"),
    403: aiErrorResponse(
      "AI off (AI_DISABLED) or route blocked; or plain-text permission errors",
    ),
    404: errorResponse("Project not found"),
    422: aiErrorResponse("The model declined (AI_REFUSED)"),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
    502: aiErrorResponse("AI_PROVIDER_ERROR"),
  },
});

const proposalRoute = createRoute({
  method: "post",
  operationId: "aiBuildProposal",
  path: "/proposal",
  tags: TAGS,
  summary: "Propose a plan from a prompt",
  description:
    'Turns a prompt such as "plan a website relaunch for Q4 with 3 sprints" into a proposal: a new project (or the given one), columns, labels, cycles with dates, modules, and tasks with descriptions, priorities, estimates and sub-tasks. Nothing is created; review it, then POST /ai-build/apply. A new project needs project:create; an existing one must be visible to the caller with AI on, and needs task:create.',
  middleware: [
    workspaceAccess.fromBody(),
    requireAiUse,
    requireAiEnabled(),
  ] as const,
  request: { body: json(buildProposalBody) },
  responses: {
    200: jsonResponse("The proposal", buildProposalResponseSchema),
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
  operationId: "aiBuildApply",
  path: "/apply",
  tags: TAGS,
  summary: "Create a reviewed plan",
  description:
    "Creates a reviewed proposal item by item through the ordinary create routes (project, columns, cycles, modules, tasks, labels, sub-tasks), under the caller's own permissions and with their usual events. A failed item is reported and the rest kept. The report carries an undo token valid for an hour. Streams Server-Sent Events (progress {done, total, kind, name, ok}, then done with the report, or error); send Accept: application/json or ?stream=false for the report as one JSON body. Makes no model call.",
  middleware: [
    workspaceAccess.fromBody(),
    requireAiUse,
    requireAiEnabled(),
  ] as const,
  request: { body: json(applyBuildBody) },
  responses: {
    200: {
      description: "The report (JSON), or its progress stream (SSE)",
      content: {
        "text/event-stream": {
          schema: z.string().openapi({
            description:
              "Events: progress {done, total, kind, name, ok}, done {report}, error {code, message}.",
          }),
        },
        "application/json": { schema: buildReportSchema },
      },
    },
    400: errorResponse("Invalid body, or no project to build into"),
    403: aiErrorResponse(
      "AI off (AI_DISABLED); or plain-text permission errors (project:create for a new project, task:create for an existing one)",
    ),
    404: errorResponse("Project not found"),
  },
});

const undoRoute = createRoute({
  method: "post",
  operationId: "aiBuildUndo",
  path: "/undo",
  tags: TAGS,
  summary: "Undo an applied plan",
  description:
    "Reverts a plan created by POST /ai/build/apply, with its undo token, through the ordinary routes under the caller's own rights: a new project goes to the trash with everything in it; otherwise its tasks and sub-tasks go to the trash and its cycles, modules and columns are deleted. Items the caller may not delete are archived when the route allows it, and anything else that fails is listed. Only the person who applied the plan can undo it, within an hour. It only runs while the items are as the plan left them: if any was edited since (fields, labels, assignees, comments, attachments, time, relations, or for a column, cycle, module or new project, what it holds), nothing is undone and a 409 names them. Makes no model call.",
  middleware: [workspaceAccess.fromBody()] as const,
  request: { body: json(undoBuildBody) },
  responses: {
    200: jsonResponse("What was undone", buildUndoResultSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("No access to the workspace"),
    404: errorResponse("Unknown token, or the project is out of reach"),
    409: jsonResponse(
      "Nothing was undone: items changed since (BUILD_EDITED), or it was already undone (BUILD_ALREADY_UNDONE)",
      buildUndoRefusalSchema,
    ),
    410: errorResponse("Undo has expired"),
  },
});

const aiBuild = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(duplicateCheckRoute, async (c) =>
    c.json(await checkDuplicates(c, c.req.valid("json")), 200),
  )
  .openapi(proposalRoute, async (c) => {
    const { projectId, prompt, depth } = c.req.valid("json");
    return c.json(await proposeBuild(c, { projectId, prompt, depth }), 200);
  })
  .openapi(applyRoute, async (c) => {
    const { projectId, proposal } = c.req.valid("json");
    if (!projectId && !proposal.project) {
      return c.text("A new project needs proposal.project", 400);
    }
    // The same target checks as the proposal: a hidden project is a 404.
    await assertBuildTarget(c, projectId);
    const call = internalApi(c);
    const workspaceId = c.get("workspaceId");
    const run = async (
      onProgress?: Parameters<typeof applyBuild>[0]["onProgress"],
    ) => {
      const ledger: BuildLedger = emptyLedger();
      const report = await applyBuild({
        call,
        workspaceId,
        projectId: projectId ?? null,
        proposal,
        ledger,
        onProgress,
      });
      const undoToken = await sealBuildUndo({
        ledger,
        userId: c.get("userId"),
        workspaceId,
        projectId: report.projectId,
      }).catch((error) => {
        // The plan is created either way; it just can't be undone.
        console.error("AI build undo token failed:", error);
        return undefined;
      });
      return undoToken ? { ...report, undoToken } : report;
    };

    if (!wantsAiStream(c)) return c.json(await run(), 200);

    c.header("Cache-Control", "no-store");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (sse) => {
      // A closed tab doesn't stop the run: the person confirmed it, and
      // stopping halfway would leave a half-built plan.
      let open = true;
      sse.onAbort(() => {
        open = false;
      });
      const write = async (event: string, data: unknown) => {
        if (!open) return;
        try {
          await sse.writeSSE({ event, data: JSON.stringify(data) });
        } catch {
          open = false;
        }
      };
      try {
        const report = await run((progress) => write("progress", progress));
        await write("done", report);
      } catch (error) {
        console.error("AI build apply failed:", error);
        await write("error", {
          code: "BUILD_FAILED",
          message: "Creating the plan failed",
        });
      }
    }) as never;
  })
  .openapi(undoRoute, async (c) => {
    const { undoToken } = c.req.valid("json");
    const outcome = await undoBuild({
      call: internalApi(c),
      token: undoToken,
      userId: c.get("userId"),
      workspaceId: c.get("workspaceId"),
    });
    return isBuildUndoRefusal(outcome)
      ? c.json(outcome, 409)
      : c.json(outcome, 200);
  });

export default aiBuild;
