import { HTTPException } from "hono/http-exception";
import { requireAiEnabled, requireAiUse } from "../ai/access";
import {
  type AiContextItem,
  assertProjectInScope,
  loadPageContext,
  loadProjectsContext,
  loadTaskContext,
  renderContext,
  resolveAiScope,
} from "../ai/context";
import { AiError } from "../ai/errors";
import { aiComplete, aiStream } from "../ai/gateway";
import { buildSystemPrompt, wrapUntrusted } from "../ai/prompt";
import { aiErrorResponse, aiStreamResponse, respondWithAi } from "../ai/sse";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { assertProjectFeatureEnabled } from "../project/features";
import { workspacePermissionChecker } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  answerLocale,
  cycleSummaryPrompt,
  projectSummaryPrompt,
  relatedTaskLines,
} from "./context";
import {
  cleanTitle,
  EDITOR_INSTRUCTIONS,
  editorRequest,
  PAGE_BLOCK_INSTRUCTIONS,
  pageBlockRequest,
  SPEC_INSTRUCTIONS,
  SUMMARY_INSTRUCTIONS,
  TITLE_INSTRUCTIONS,
} from "./prompts";
import {
  editorAssistBody,
  MAX_PAGE_CHARS,
  MAX_SELECTION_CHARS,
  pageBlockBody,
  pageTitleBody,
  specDraftBody,
  summarizeBody,
} from "./schema";
import { TASK_SUMMARY_REQUEST, taskHistoryLines } from "./task-summary";

// AI writing (B6): editor block actions, one-click summaries and first-draft
// specs. Every route only reads: the answer streams back for the person to
// review, and anything they keep is saved through the ordinary page and task
// routes (and, on pages, through the collaborative editor). Nothing here
// writes, publishes events or stores prompt text.

const TAGS = ["AI"];
const json = <T>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const middleware = [
  workspaceAccess.fromBody(),
  requireAiUse,
  requireAiEnabled(),
] as const;

const commonErrors = {
  400: errorResponse("Invalid body"),
  403: aiErrorResponse(
    "AI_DISABLED (AI off for the instance, workspace or project) or AI_ROUTE_BLOCKED; or plain-text errors: no workspace access, missing ai:use or the permission named above, or the project's feature is off",
  ),
  404: errorResponse(
    "The page, task, cycle or project does not exist, is in another workspace, or is in a project the caller can't see",
  ),
  409: aiErrorResponse("AI_NOT_CONFIGURED"),
  429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
};

const assistRoute = createRoute({
  method: "post",
  operationId: "aiEditorAssist",
  path: "/assist",
  tags: TAGS,
  summary: "Rewrite a passage with AI",
  description:
    "Summarize, improve, shorten, lengthen, fix, translate or custom-edit a passage selected in a page, a task description or a comment being written, optionally in a tone (professional or casual). Needs ai:use and edit rights on the target (page:update, or task:update for a task description and for a comment draft, the right posting a comment needs); the answer is a proposal the editor shows for review and never applies by itself. Feature editor_assist, fast tier.",
  middleware: [...middleware] as const,
  request: { body: json(editorAssistBody) },
  responses: {
    200: aiStreamResponse("The rewritten passage, as Markdown."),
    ...commonErrors,
  },
});

const summarizeRoute = createRoute({
  method: "post",
  operationId: "aiSummarize",
  path: "/summarize",
  tags: TAGS,
  summary: "Summarize a cycle, project, page or task",
  description:
    "A short summary: a cycle's progress, risks and notable changes (cycle:read and task:read; Cycles on), a project's status and health (task:read), a page's TL;DR (page:read), or where a task stands from its description, latest comments and change history (task:read). Cycle and project summaries include the delivery forecast and risk radar when the caller has analytics:read. Feature summarize; fast tier for pages and tasks, balanced otherwise.",
  middleware: [...middleware] as const,
  request: { body: json(summarizeBody) },
  responses: {
    200: aiStreamResponse("The summary, as Markdown."),
    ...commonErrors,
  },
});

const specDraftRoute = createRoute({
  method: "post",
  operationId: "aiSpecDraft",
  path: "/spec-draft",
  tags: TAGS,
  summary: "Draft a spec page from a task",
  description:
    "A first-draft specification (problem, goals, non-goals, approach, open questions) from the task, its latest comments and its related tasks, for the caller to review before creating a page. Needs ai:use, task:read and page:create, with Pages on in the task's project. Feature spec_draft, balanced tier.",
  middleware: [...middleware] as const,
  request: { body: json(specDraftBody) },
  responses: {
    200: aiStreamResponse("The draft spec, as Markdown."),
    ...commonErrors,
  },
});

const pageTitleRoute = createRoute({
  method: "post",
  operationId: "aiPageTitle",
  path: "/title",
  tags: TAGS,
  summary: "Suggest a title for a page",
  description:
    "One suggested title for a page from its content (the live content sent by the editor, else the saved one), for the caller to apply with the ordinary page update. Needs ai:use, page:read and page:update. Feature editor_assist, fast tier.",
  middleware: [...middleware] as const,
  request: { body: json(pageTitleBody) },
  responses: {
    200: jsonResponse(
      "The suggested title",
      z
        .object({
          title: z.string().openapi({
            description: "One plain line of at most 255 characters.",
          }),
        })
        .openapi("AiPageTitle"),
    ),
    ...commonErrors,
    422: errorResponse("The page has no content to title yet"),
    502: aiErrorResponse("AI_PROVIDER_ERROR: no usable title came back"),
  },
});

const pageBlockRoute = createRoute({
  method: "post",
  operationId: "aiPageBlock",
  path: "/page-block",
  tags: TAGS,
  summary: "Generate an AI block from a page",
  description:
    "A block of Markdown generated from the page: a TL;DR, an FAQ, action items or a custom instruction. The editor shows it as a proposal to accept, regenerate or discard; nothing is saved here. Needs ai:use, page:read and page:update. Feature editor_assist, fast tier.",
  middleware: [...middleware] as const,
  request: { body: json(pageBlockBody) },
  responses: {
    200: aiStreamResponse("The generated block, as Markdown."),
    ...commonErrors,
    422: errorResponse("The page has no content to work from yet"),
  },
});

/** The page's live text from the editor, else its saved text. */
function pageSource(saved: string, live: string | undefined) {
  const text = (live ?? saved).trim();
  if (!text) {
    throw new HTTPException(422, { message: "The page is empty" });
  }
  return text;
}

const forbidden = () =>
  new HTTPException(403, { message: "Insufficient permissions" });

const aiWriting = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(assistRoute, async (c) => {
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const scope = await resolveAiScope(c);
    const can = await workspacePermissionChecker(c);

    // The target decides visibility, the project switch and the data tier;
    // only the selected passage goes to the model.
    let target: AiContextItem;
    if (body.target.kind === "new_task") {
      // A task still being created: its project decides the switch and tier.
      assertProjectInScope(scope, body.target.id);
      const [project] = await loadProjectsContext(scope, [body.target.id]);
      if (!project)
        throw new HTTPException(404, { message: "Project not found" });
      if (!can({ task: ["create"] })) throw forbidden();
      target = project;
    } else if (body.target.kind === "task") {
      const [task] = await loadTaskContext(scope, body.target.id, {
        comments: 0,
        maxChars: 200,
      });
      if (!task) throw new HTTPException(404, { message: "Task not found" });
      if (!can({ task: ["update"] })) throw forbidden();
      target = task;
    } else if (body.target.kind === "comment_draft") {
      // A comment being written on a task: the right to comment there
      // (task:update, as POST /activity/comment) is enough.
      const [task] = await loadTaskContext(scope, body.target.id, {
        comments: 0,
        maxChars: 200,
      });
      if (!task) throw new HTTPException(404, { message: "Task not found" });
      if (!can({ task: ["update"] })) throw forbidden();
      target = task;
    } else {
      target = await loadPageContext(scope, body.target.id, { maxChars: 200 });
      if (!can({ page: ["update"] })) throw forbidden();
    }

    const locale = await answerLocale(userId, body.locale);
    const stream = await aiStream({
      workspaceId,
      userId,
      feature: "editor_assist",
      tier: "fast",
      context: [target],
      system: buildSystemPrompt({ instructions: EDITOR_INSTRUCTIONS, locale }),
      messages: [
        {
          role: "user",
          content: `${editorRequest(body)}\n\n${wrapUntrusted({
            source: `${body.target.kind}-passage`,
            text: body.text,
            maxChars: MAX_SELECTION_CHARS,
          })}`,
        },
      ],
      maxTokens: body.action === "longer" ? 6000 : 4096,
    });
    return respondWithAi(c, stream);
  })
  .openapi(summarizeRoute, async (c) => {
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const scope = await resolveAiScope(c);
    const can = await workspacePermissionChecker(c);
    const locale = await answerLocale(userId, body.locale);
    const system = buildSystemPrompt({
      instructions: SUMMARY_INSTRUCTIONS,
      locale,
    });

    if (body.kind === "page") {
      const page = await loadPageContext(scope, body.id, { maxChars: 40_000 });
      const stream = await aiStream({
        workspaceId,
        userId,
        feature: "summarize",
        tier: "fast",
        context: [page],
        system,
        messages: [
          {
            role: "user",
            content: `Write a TL;DR of this page: two or three sentences, then the key points as bullets (decisions, owners, dates and open questions when the page has them).\n\n${renderContext([page], { maxChars: 42_000 })}`,
          },
        ],
        maxTokens: 3000,
      });
      return respondWithAi(c, stream);
    }

    if (body.kind === "task") {
      const items = await loadTaskContext(scope, body.id, {
        comments: 30,
        maxChars: 12_000,
      });
      const history = await taskHistoryLines(body.id);
      const historyBlock = history.length
        ? `\n\n${wrapUntrusted({
            source: "task-history",
            text: history.join("\n"),
            maxChars: 8000,
          })}`
        : "";
      const stream = await aiStream({
        workspaceId,
        userId,
        feature: "summarize",
        tier: "fast",
        context: items,
        system,
        messages: [
          {
            role: "user",
            content: `${TASK_SUMMARY_REQUEST}\n\n${renderContext(items, { maxChars: 40_000 })}${historyBlock}`,
          },
        ],
        maxTokens: 2000,
      });
      return respondWithAi(c, stream);
    }

    const prompt =
      body.kind === "cycle"
        ? await cycleSummaryPrompt(scope, body.id, can)
        : await projectSummaryPrompt(scope, body.id, can);
    const stream = await aiStream({
      workspaceId,
      userId,
      feature: "summarize",
      tier: "balanced",
      projectIds: [prompt.projectId],
      dataTier: scope.restrictedProjectIds.has(prompt.projectId)
        ? "restricted"
        : "private",
      system,
      messages: [{ role: "user", content: prompt.text }],
      maxTokens: 3000,
    });
    return respondWithAi(c, stream);
  })
  .openapi(specDraftRoute, async (c) => {
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const scope = await resolveAiScope(c);
    const can = await workspacePermissionChecker(c);

    const items = await loadTaskContext(scope, body.taskId, { comments: 20 });
    const task = items[0];
    if (!task?.projectId) {
      throw new HTTPException(404, { message: "Task not found" });
    }
    if (!can({ page: ["create"] })) throw forbidden();
    await assertProjectFeatureEnabled(task.projectId, "pages");

    const [project] = await loadProjectsContext(scope, [task.projectId]);
    const related = await relatedTaskLines(scope, task.id);
    const context = [...items, ...(project ? [project] : [])];
    const relatedBlock = related
      ? `\n\n${wrapUntrusted({ source: `related:${task.source}`, text: related, maxChars: 6000 })}`
      : "";
    const locale = await answerLocale(userId, body.locale);
    const stream = await aiStream({
      workspaceId,
      userId,
      feature: "spec_draft",
      tier: "balanced",
      context,
      system: buildSystemPrompt({ instructions: SPEC_INSTRUCTIONS, locale }),
      messages: [
        {
          role: "user",
          content: `Draft a spec for the task below.\n\n${renderContext(context, { maxChars: 50_000 })}${relatedBlock}`,
        },
      ],
      maxTokens: 6000,
    });
    return respondWithAi(c, stream);
  })
  .openapi(pageTitleRoute, async (c) => {
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const scope = await resolveAiScope(c);
    const can = await workspacePermissionChecker(c);
    const page = await loadPageContext(scope, body.pageId, {
      maxChars: MAX_PAGE_CHARS,
    });
    if (!can({ page: ["update"] })) throw forbidden();
    const text = pageSource(page.text, body.text);
    const locale = await answerLocale(userId, body.locale);
    const result = await aiComplete({
      workspaceId,
      userId,
      feature: "editor_assist",
      tier: "fast",
      context: [page],
      system: buildSystemPrompt({ instructions: TITLE_INSTRUCTIONS, locale }),
      messages: [
        {
          role: "user",
          content: `Suggest a title for this page.\n\n${wrapUntrusted({
            source: "page",
            text,
            maxChars: 12_000,
          })}`,
        },
      ],
      maxTokens: 200,
      effort: "low",
    });
    const title = cleanTitle(result.text);
    if (!title) {
      throw new AiError(
        "AI_PROVIDER_ERROR",
        "The AI model did not suggest a title",
      );
    }
    return c.json({ title }, 200);
  })
  .openapi(pageBlockRoute, async (c) => {
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const scope = await resolveAiScope(c);
    const can = await workspacePermissionChecker(c);
    const page = await loadPageContext(scope, body.pageId, {
      maxChars: MAX_PAGE_CHARS,
    });
    if (!can({ page: ["update"] })) throw forbidden();
    const text = pageSource(page.text, body.text);
    const locale = await answerLocale(userId, body.locale);
    const stream = await aiStream({
      workspaceId,
      userId,
      feature: "editor_assist",
      tier: "fast",
      context: [page],
      system: buildSystemPrompt({
        instructions: PAGE_BLOCK_INSTRUCTIONS,
        locale,
      }),
      messages: [
        {
          role: "user",
          content: `${pageBlockRequest(body)}\n\n${wrapUntrusted({
            source: "page",
            text,
            maxChars: MAX_PAGE_CHARS,
          })}`,
        },
      ],
      maxTokens: 3000,
    });
    return respondWithAi(c, stream);
  });

export default aiWriting;
