import { requireAiUse } from "../ai/access";
import { AI_FEATURES } from "../ai/features";
import db from "../database";
import { aiFeedbackTable } from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { workspaceAccess } from "../utils/workspace-access-middleware";

// Thumbs up or down on an AI answer (ai_feedback). The prompt and the answer
// are never sent or stored, so the "prompts are not stored" promise holds;
// rates show on the usage page (GET /ai/usage `feedback`).

export const MAX_FEEDBACK_REASON_CHARS = 300;

export const aiFeedbackBody = z
  .strictObject({
    workspaceId: z.string().min(1),
    feature: z.enum(AI_FEATURES).openapi({
      description: "The AI feature that answered, e.g. ask or editor_assist.",
    }),
    rating: z.union([z.literal(1), z.literal(-1)]).openapi({
      description: "1 for thumbs up, -1 for thumbs down.",
    }),
    reason: z
      .string()
      .trim()
      .max(MAX_FEEDBACK_REASON_CHARS)
      .optional()
      .openapi({
        description:
          "Why, in the person's words (at most 300 characters). Never include the question or the answer.",
      }),
    provider: z.string().trim().max(64).optional().openapi({
      description: "The provider of the rated answer (from its `meta`).",
    }),
    model: z.string().trim().max(128).optional().openapi({
      description: "The model of the rated answer (from its `meta`).",
    }),
  })
  .openapi("AiFeedbackRequest");

const createFeedbackRoute = createRoute({
  method: "post",
  operationId: "createAiFeedback",
  path: "/",
  tags: ["AI"],
  summary: "Rate an AI answer",
  description:
    "Record a thumbs up or down on an AI answer, with an optional short reason and the answer's provider and model. No prompt or answer text is stored. Needs ai:use.",
  middleware: [
    boundedRequestBody(8 * 1024),
    workspaceAccess.fromBody(),
    requireAiUse,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: aiFeedbackBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The feedback was recorded",
      z.object({ id: z.string() }).openapi("AiFeedbackCreated"),
    ),
    400: errorResponse("Invalid body"),
    403: errorResponse("No workspace access, or missing ai:use"),
    413: errorResponse("The body is larger than 8 KB"),
  },
});

const aiFeedback = apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  createFeedbackRoute,
  async (c) => {
    const body = c.req.valid("json");
    const [row] = await db
      .insert(aiFeedbackTable)
      .values({
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        feature: body.feature,
        rating: body.rating,
        reason: body.reason || null,
        provider: body.provider || null,
        model: body.model || null,
      })
      .returning({ id: aiFeedbackTable.id });
    return c.json({ id: row?.id ?? "" }, 200);
  },
);

export default aiFeedback;
