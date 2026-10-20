import { requireAiUse } from "../ai/access";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { workspacePermissionChecker } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { BUDGET_WARNING_PERCENT, workspaceBudgetStatus } from "./status";

// GET /ai/budget-status: how much of the monthly AI budget is used, and
// whether the 80% warning applies. Amounts are for people who manage AI;
// everyone who may use AI sees the percentage and the warning.

const budgetStatusSchema = z
  .object({
    monthlyCapMicros: z.number().int().nullable().openapi({
      description:
        "The workspace's monthly cap in micro-dollars; null without a cap, or for callers without ai:manage.",
    }),
    usedMicros: z.number().int().nullable().openapi({
      description:
        "Spend this UTC month in micro-dollars; null for callers without ai:manage.",
    }),
    usedPercent: z.number().int().nullable().openapi({
      description:
        "Whole percent of the cap used this month (may pass 100); null without a cap.",
    }),
    warning: z.boolean().openapi({
      description: `True from ${BUDGET_WARNING_PERCENT}% of the cap.`,
    }),
    month: z.string().openapi({ description: "YYYY-MM (UTC)." }),
  })
  .openapi("AiBudgetStatus");

const budgetStatusRoute = createRoute({
  method: "get",
  operationId: "getAiBudgetStatus",
  path: "/",
  tags: ["AI"],
  summary: "Get the AI budget status",
  description: `The workspace's monthly AI budget use, with a warning from ${BUDGET_WARNING_PERCENT}% of the cap. Needs ai:use; amounts are included only for callers with ai:manage. People who manage AI also get one inbox notice per month when the warning starts.`,
  middleware: [workspaceAccess.fromQuery(), requireAiUse] as const,
  request: {
    query: z.object({
      workspaceId: z.string().min(1).openapi({ description: "Workspace ID" }),
    }),
  },
  responses: {
    200: jsonResponse("The budget status", budgetStatusSchema),
    403: errorResponse("No workspace access, or missing ai:use"),
  },
});

const aiBudget = apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  budgetStatusRoute,
  async (c) => {
    const status = await workspaceBudgetStatus(c.get("workspaceId"));
    const can = await workspacePermissionChecker(c);
    const manager = can({ ai: ["manage"] });
    return c.json(
      {
        ...status,
        monthlyCapMicros: manager ? status.monthlyCapMicros : null,
        usedMicros: manager ? status.usedMicros : null,
      },
      200,
    );
  },
);

export default aiBudget;
