import { requireAiEnabled, requireAiUse } from "../ai/access";
import { aiErrorResponse } from "../ai/sse";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { whiteboardRoute } from "../whiteboard/middleware";
import { whiteboardParam } from "../whiteboard/schema";
import { proposeBrainstorm, proposeGroups, proposeSummary } from "./propose";
import {
  whiteboardAiGroupsSchema,
  whiteboardAiIdeasSchema,
  whiteboardAiSummarySchema,
} from "./response";
import {
  whiteboardBrainstormBody,
  whiteboardGroupBody,
  whiteboardSummarizeBody,
} from "./schema";

// AI on whiteboards (feature "whiteboard"). Every route proposes and never
// writes: the editor previews the answer and, when the person accepts,
// writes it through the board's realtime document like a manual edit.

const TAGS = ["AI"];
const NOT_FOUND =
  "Unknown whiteboard, one in the trash, or one in a project the caller can't see";
const AI_403 =
  "AI is off for the instance, workspace or project (AI_DISABLED), the data may not leave (AI_ROUTE_BLOCKED), missing ai:use or the whiteboard permission, or the Whiteboards feature is off";

function jsonBody<T>(schema: T) {
  return { required: true, content: { "application/json": { schema } } };
}

const aiFailures = {
  403: aiErrorResponse(AI_403),
  404: errorResponse(NOT_FOUND),
  409: aiErrorResponse(
    "No AI provider is set up (AI_NOT_CONFIGURED), or the board is locked or archived",
  ),
  429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
  502: aiErrorResponse("The AI provider failed (AI_PROVIDER_ERROR)"),
} as const;

const brainstormRoute = createRoute({
  method: "post",
  operationId: "aiWhiteboardBrainstorm",
  path: "/{id}/brainstorm",
  tags: TAGS,
  summary: "Brainstorm sticky notes on a whiteboard",
  description:
    "Proposes sticky-note ideas (and a title for them) for a topic, avoiding what is already on the board. Nothing is written; the editor shows the ideas and adds them when the person accepts. Needs whiteboard:update on a board that is not locked or archived, ai:use, and AI on for the workspace and the board's project. Feature whiteboard, fast tier.",
  middleware: [
    ...whiteboardRoute("update"),
    requireAiUse,
    requireAiEnabled(),
  ] as const,
  request: {
    params: whiteboardParam,
    body: jsonBody(whiteboardBrainstormBody),
  },
  responses: {
    200: jsonResponse("The proposed ideas", whiteboardAiIdeasSchema),
    400: errorResponse("Invalid body"),
    ...aiFailures,
  },
});

const groupRoute = createRoute({
  method: "post",
  operationId: "aiWhiteboardGroup",
  path: "/{id}/group",
  tags: TAGS,
  summary: "Group whiteboard notes into themes",
  description:
    "Proposes themes for the given sticky notes and which notes belong to each; every note is in exactly one group (notes the model left out come last, without a title). Nothing is written; the editor arranges the notes into titled frames when the person accepts. Needs whiteboard:update on a board that is not locked or archived, ai:use, and AI on for the workspace and the board's project. Feature whiteboard, balanced tier.",
  middleware: [
    ...whiteboardRoute("update"),
    requireAiUse,
    requireAiEnabled(),
  ] as const,
  request: { params: whiteboardParam, body: jsonBody(whiteboardGroupBody) },
  responses: {
    200: jsonResponse("The proposed groups", whiteboardAiGroupsSchema),
    400: errorResponse(
      "Invalid body, or fewer than two unlocked notes with text",
    ),
    ...aiFailures,
  },
});

const summarizeRoute = createRoute({
  method: "post",
  operationId: "aiWhiteboardSummarize",
  path: "/{id}/summarize",
  tags: TAGS,
  summary: "Summarize a whiteboard",
  description:
    "Summarizes the text on the board, or on the given elements (a frame brings its contents), into a title and a few lines. Task cards contribute their key and title when the caller may read tasks; drawings and images are not read. Nothing is written; the editor offers to copy the summary or place it on the board. Needs whiteboard:read, ai:use, and AI on for the workspace and the board's project. Feature whiteboard, fast tier.",
  middleware: [
    ...whiteboardRoute("read"),
    requireAiUse,
    requireAiEnabled(),
  ] as const,
  request: { params: whiteboardParam, body: jsonBody(whiteboardSummarizeBody) },
  responses: {
    200: jsonResponse("The proposed summary", whiteboardAiSummarySchema),
    400: errorResponse("Invalid body, or there is no text to summarize"),
    ...aiFailures,
  },
});

const whiteboardAi = apiRouter<
  BaseVariables & { workspaceId: string; projectId: string | null }
>()
  .openapi(brainstormRoute, async (c) =>
    c.json(
      await proposeBrainstorm(c, c.req.valid("param").id, c.req.valid("json")),
      200,
    ),
  )
  .openapi(groupRoute, async (c) =>
    c.json(
      await proposeGroups(c, c.req.valid("param").id, c.req.valid("json")),
      200,
    ),
  )
  .openapi(summarizeRoute, async (c) =>
    c.json(
      await proposeSummary(c, c.req.valid("param").id, c.req.valid("json")),
      200,
    ),
  );

export default whiteboardAi;
