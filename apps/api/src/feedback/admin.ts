import { requireInstanceAdmin } from "../instance-admin/middleware";
import { requireRecentAuth } from "../instance-admin/reauth";
import { instanceReauthRequiredSchema } from "../instance-admin/response";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { requireUserSession } from "../utils/require-user-session";
import {
  deleteAdminFeedback,
  exportAdminFeedbackCsv,
  getAdminFeedbackSummary,
  listAdminFeedback,
  MAX_FEEDBACK_EXPORT_ROWS,
  purgeAdminFeedback,
} from "./controllers/admin";
import {
  adminFeedbackPageSchema,
  adminFeedbackSummarySchema,
  deletedFeedbackSchema,
} from "./response";
import {
  adminFeedbackFilterQuery,
  adminFeedbackSummaryQuery,
  feedbackIdParam,
  listAdminFeedbackQuery,
  purgeFeedbackQuery,
} from "./schema";

// Instance settings → Feedback: what people on this instance said, for its
// admins only. The settings themselves are catalog keys (group "feedback")
// saved through PATCH /instance-admin/settings.

const TAGS = ["Instance admin"];
const ADMIN_NOTE =
  " Instance admins only, with a signed-in session: API keys are refused.";
const REAUTH_NOTE =
  " Needs a recent sign-in (see POST /instance-admin/reauth); otherwise 403 with code REAUTH_REQUIRED.";
const forbidden = errorResponse(
  "Not an instance admin, or an API key instead of a user session",
);
const forbiddenOrStale = {
  description:
    "Not an instance admin, an API key instead of a user session, or no recent sign-in (JSON with code REAUTH_REQUIRED)",
  content: {
    "text/plain": { schema: z.string() },
    "application/json": { schema: instanceReauthRequiredSchema },
  },
};

const summaryRoute = createRoute({
  method: "get",
  operationId: "getInstanceFeedbackSummary",
  path: "/summary",
  tags: TAGS,
  summary: "Summarise feedback",
  description: `For one scale over a period (180 days by default): the answer count, average, share of happy answers, NPS for the 0-10 scale, the distribution of scores and a weekly trend, plus counts by source and of comments.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  request: { query: adminFeedbackSummaryQuery },
  responses: {
    200: jsonResponse("The summary", adminFeedbackSummarySchema),
    400: errorResponse("Invalid query"),
    403: forbidden,
  },
});

const exportRoute = createRoute({
  method: "get",
  operationId: "exportInstanceFeedback",
  path: "/export",
  tags: TAGS,
  summary: "Export feedback as CSV",
  description: `The filtered answers as a CSV attachment (UTF-8 with a byte-order mark), newest first, at most ${MAX_FEEDBACK_EXPORT_ROWS.toLocaleString("en-US")} rows, with each person's name and email.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  request: { query: adminFeedbackFilterQuery },
  responses: {
    200: {
      description: "The CSV file",
      content: { "text/csv": { schema: { type: "string" as const } } },
    },
    400: errorResponse("Invalid query"),
    403: forbidden,
  },
});

const listRoute = createRoute({
  method: "get",
  operationId: "listInstanceFeedback",
  path: "/",
  tags: TAGS,
  summary: "List feedback",
  description: `Answers newest first, with who sent them. Filter by source, scale, score, comment or text; page with nextCursor.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  request: { query: listAdminFeedbackQuery },
  responses: {
    200: jsonResponse("A page of answers", adminFeedbackPageSchema),
    400: errorResponse("Invalid query or cursor"),
    403: forbidden,
  },
});

const purgeRoute = createRoute({
  method: "delete",
  operationId: "purgeInstanceFeedback",
  path: "/",
  tags: TAGS,
  summary: "Delete old feedback",
  description: `Delete every answer older than olderThanDays (0 deletes all). Recorded in the instance audit trail.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin, requireRecentAuth],
  request: { query: purgeFeedbackQuery },
  responses: {
    200: jsonResponse("How many were deleted", deletedFeedbackSchema),
    400: errorResponse("Invalid query"),
    403: forbiddenOrStale,
    429: errorResponse("Too many deletions; retry after Retry-After"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  operationId: "deleteInstanceFeedback",
  path: "/{id}",
  tags: TAGS,
  summary: "Delete one answer",
  description: `Recorded in the instance audit trail.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin, requireRecentAuth],
  request: { params: feedbackIdParam },
  responses: {
    200: jsonResponse("Deleted", deletedFeedbackSchema),
    403: forbiddenOrStale,
    404: errorResponse("No such feedback"),
    429: errorResponse("Too many deletions; retry after Retry-After"),
  },
});

const feedbackAdmin = apiRouter()
  .openapi(summaryRoute, async (c) =>
    c.json(await getAdminFeedbackSummary(c.req.valid("query")), 200),
  )
  .openapi(exportRoute, async (c) => {
    const date = new Date().toISOString().slice(0, 10);
    return new Response(await exportAdminFeedbackCsv(c.req.valid("query")), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="feedback-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  })
  .openapi(listRoute, async (c) =>
    c.json(await listAdminFeedback(c.req.valid("query")), 200),
  )
  .openapi(purgeRoute, async (c) =>
    c.json(
      await purgeAdminFeedback(
        c.req.valid("query").olderThanDays,
        c.get("userId"),
      ),
      200,
    ),
  )
  .openapi(deleteRoute, async (c) =>
    c.json(
      await deleteAdminFeedback(c.req.valid("param").id, c.get("userId")),
      200,
    ),
  );

export default feedbackAdmin;
