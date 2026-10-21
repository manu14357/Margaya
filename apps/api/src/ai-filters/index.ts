import { requireAiEnabled, requireAiUse } from "../ai/access";
import {
  assertProjectInScope,
  projectDataTier,
  resolveAiScope,
} from "../ai/context";
import { aiCompleteJson } from "../ai/gateway";
import { buildSystemPrompt, wrapUntrusted } from "../ai/prompt";
import { aiErrorResponse } from "../ai/sse";
import { userLocale } from "../ai-translate/locale";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { getUserTimezone } from "../utils/timezone";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { todayInTimezone } from "../utils/zoned-date";
import { FILTER_INSTRUCTIONS, FILTER_JSON_SCHEMA } from "./prompt";
import { resolveFilterAnswer, vocabularyLines } from "./resolve";
import { parsedFilterSchema, parseFilterBody } from "./schema";
import { loadFilterVocabulary } from "./vocabulary";

// Natural-language task filters: "my overdue bugs in Sprint 1" becomes the
// task query's filter tree. The model only maps words to the references it
// was given; resolve.ts keeps what is real and the engine can run. Nothing
// is saved; the toolbar applies the tree like any filter the person picks.

const TAGS = ["AI"];

const parseRoute = createRoute({
  method: "post",
  operationId: "aiParseTaskFilter",
  path: "/parse",
  tags: TAGS,
  summary: "Turn a sentence into task filters",
  description:
    'Maps a description such as "my overdue bugs in Sprint 1" to a task-query filter group (status, group, priority, assignee, creator, label, cycle, module, project and date conditions) over values the caller can see. Unknown names and values are dropped and listed in `dropped`; the tree always passes the task query\'s validation. With projectId the filter is for that project (statuses and modules are its own); without it, for the workspace. Needs ai:use and task:read, with AI on for the workspace (and the project). Feature nl_filter, fast tier.',
  middleware: [
    workspaceAccess.fromBody(),
    requireAiUse,
    requireWorkspacePermission({ task: ["read"] }),
    requireAiEnabled(),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: parseFilterBody } },
    },
  },
  responses: {
    200: jsonResponse("The filter that was understood", parsedFilterSchema),
    400: errorResponse("Invalid body"),
    403: aiErrorResponse(
      "AI is off (AI_DISABLED), the data may not leave (AI_ROUTE_BLOCKED), or missing ai:use or task:read",
    ),
    404: errorResponse("Project not found"),
    409: aiErrorResponse("No AI provider is set up (AI_NOT_CONFIGURED)"),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
    502: aiErrorResponse("The AI provider failed (AI_PROVIDER_ERROR)"),
  },
});

const aiFilters = apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  parseRoute,
  async (c) => {
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const scope = await resolveAiScope(c);
    const projectId = body.projectId ?? null;
    if (projectId) assertProjectInScope(scope, projectId);

    const [vocabulary, timezone] = await Promise.all([
      loadFilterVocabulary(scope, projectId),
      getUserTimezone(userId),
    ]);
    const today = todayInTimezone(timezone);
    const { value } = await aiCompleteJson<unknown>({
      workspaceId,
      userId,
      feature: "nl_filter",
      tier: "fast",
      ...(projectId
        ? {
            projectIds: [projectId],
            dataTier: projectDataTier(scope, projectId),
          }
        : {}),
      system: buildSystemPrompt({
        instructions: FILTER_INSTRUCTIONS,
        locale: body.locale ?? (await userLocale(userId)),
      }),
      messages: [
        {
          role: "user",
          content: [
            `Today is ${today}. Keys available here: ${[...vocabulary.keys].join(", ")}.`,
            "The names you may use, by reference:",
            wrapUntrusted({
              source: "vocabulary",
              text: vocabularyLines(vocabulary) || "(none)",
              maxChars: 20_000,
            }),
            "The description to turn into filters:",
            wrapUntrusted({ source: "request", text: body.text }),
            "Return the filter as JSON.",
          ].join("\n\n"),
        },
      ],
      jsonSchema: FILTER_JSON_SCHEMA,
      maxTokens: 1500,
      effort: "low",
    });
    return c.json(resolveFilterAnswer(value, vocabulary), 200);
  },
);

export default aiFilters;
