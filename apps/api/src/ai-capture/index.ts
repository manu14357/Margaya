import { requireAiEnabled, requireAiUse } from "../ai/access";
import { aiErrorResponse } from "../ai/sse";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireProjectFeature } from "../project/features";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { analyzeCapture } from "./analyze";
import { captureResultSchema } from "./response";
import {
  captureBody,
  captureProjectParam,
  MAX_CAPTURE_BODY_BYTES,
} from "./schema";

// Capture to issue (C6): evidence in, proposed intake requests out. Nothing
// is created here; people submit each reviewed proposal through
// POST /intake/project/{projectId} and attach files with the task
// attachment routes.

const captureRoute = createRoute({
  method: "post",
  operationId: "aiCaptureAnalyze",
  path: "/{projectId}",
  tags: ["AI"],
  summary: "Propose intake requests from a capture",
  description:
    "Turn screenshots, key frames of a screen recording (taken in the browser; video is never uploaded) or a meeting transcript into proposed intake requests: a title, a summary, steps to reproduce, expected and actual behaviour, a suggested priority and existing labels, in the caller's language. A transcript may yield up to 10 action items, each with an owner when it names a project member. Images must be PNG, JPEG or WebP whose bytes match the declared type, at most 6 and 3.75 MB each (9 MB together); their metadata (EXIF, XMP, IPTC, text chunks) is removed before the model call. Images count as private data for routing. Nothing is created or stored. Needs ai:use and intake:create, with AI and Intake on for the project; restricted projects need the workspace to include them in AI.",
  middleware: [
    boundedRequestBody(MAX_CAPTURE_BODY_BYTES, 30_000),
    workspaceAccess.fromProject("projectId", {
      notFoundMessage: "Project not found",
    }),
    requireAiUse,
    requireWorkspacePermission({ intake: ["create"] }),
    requireAiEnabled(),
    requireProjectFeature("intake"),
    requireProjectFeature("ai"),
  ] as const,
  request: {
    params: captureProjectParam,
    body: {
      required: true,
      content: { "application/json": { schema: captureBody } },
    },
  },
  responses: {
    200: jsonResponse("The proposed requests", captureResultSchema),
    400: errorResponse(
      "Invalid body, an image of another type than declared, or an unreadable image",
    ),
    403: aiErrorResponse(
      "AI is off (AI_DISABLED: instance, workspace or project, or a restricted project left out of AI), the data may not leave (AI_ROUTE_BLOCKED); or a plain-text error: no workspace access, missing ai:use or intake:create, or Intake off for the project",
    ),
    404: errorResponse("Project not found"),
    409: aiErrorResponse("No AI provider is set up (AI_NOT_CONFIGURED)"),
    413: errorResponse("Too many images, or images or body too large"),
    422: aiErrorResponse("The AI model declined the request (AI_REFUSED)"),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
    502: aiErrorResponse("The AI provider failed (AI_PROVIDER_ERROR)"),
  },
});

const capture = apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  captureRoute,
  async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(await analyzeCapture(c, projectId, c.req.valid("json")), 200);
  },
);

export default capture;
