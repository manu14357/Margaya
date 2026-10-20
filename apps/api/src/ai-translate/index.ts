import { requireAiEnabled, requireAiUse } from "../ai/access";
import { aiErrorResponse } from "../ai/sse";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { translationSchema } from "./response";
import { translateBody } from "./schema";
import { translateContent } from "./translate";
import "./subscribers";

// Translate-on-read route (B8).

const translateRoute = createRoute({
  method: "post",
  operationId: "aiTranslate",
  path: "/",
  tags: ["AI"],
  summary: "Translate a comment, description or page",
  description:
    "Translate a comment, a task's description or a page into the reader's language (default: the caller's UI locale). Translations are cached per source and language and replaced when the source changes; a text already in that language answers same_language. Needs ai:use and read access to the source: it must be visible to the caller and in a project with AI on.",
  middleware: [
    workspaceAccess.fromBody(),
    requireAiUse,
    requireAiEnabled(),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: translateBody } },
    },
  },
  responses: {
    200: jsonResponse("The translation", translationSchema),
    400: errorResponse("Invalid body, or the source is empty"),
    403: aiErrorResponse(
      "AI is off (AI_DISABLED), the data may not leave (AI_ROUTE_BLOCKED), or missing ai:use or read permission",
    ),
    404: errorResponse("Comment, task or page not found"),
    409: aiErrorResponse("No AI provider is set up (AI_NOT_CONFIGURED)"),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
    502: aiErrorResponse("The AI provider failed (AI_PROVIDER_ERROR)"),
  },
});

const translate = apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  translateRoute,
  async (c) => {
    const { kind, id, targetLocale } = c.req.valid("json");
    return c.json(await translateContent(c, { kind, id, targetLocale }), 200);
  },
);

export default translate;
