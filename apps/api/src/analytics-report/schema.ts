import { analyticsChartRequestSchema } from "../analytics/schema";
import { z } from "../openapi";

export const REPORT_VISIBILITIES = ["private", "workspace"] as const;
export const MAX_REPORTS_PER_OWNER = 100;

export const reportParam = z.object({ id: z.string() });

export const listReportsQuery = z.object({ workspaceId: z.string().min(1) });

/**
 * A chart-builder configuration: the chart request without the workspace
 * and the viewer's context (time zone and week start come from whoever
 * opens it), plus the builder's sort choice.
 */
export const reportConfigSchema = analyticsChartRequestSchema
  .omit({ workspaceId: true, context: true })
  .extend({
    sortByValue: z.boolean().optional().openapi({
      description: "Sort category buckets by value instead of natural order.",
    }),
  })
  .strict()
  .openapi("AnalyticsReportConfig", {
    description:
      "The saved chart: task set (scope, filters, archived, sub-tasks), x-axis, segment, metric, date bucket and display options.",
  });

export type ReportConfig = z.infer<typeof reportConfigSchema>;

const name = z.string().trim().min(1).max(80);
const visibility = z.enum(REPORT_VISIBILITIES).openapi({
  description:
    "private: only the owner sees it. workspace: everyone with analytics access.",
});

export const createReportBody = z
  .object({
    workspaceId: z.string().min(1),
    name,
    visibility: visibility.optional(),
    config: reportConfigSchema,
  })
  .strict()
  .openapi("CreateAnalyticsReportBody");

export const updateReportBody = z
  .object({
    name: name.optional(),
    visibility: visibility.optional(),
    config: reportConfigSchema.optional(),
  })
  .strict()
  .openapi("UpdateAnalyticsReportBody", {
    description: "Any subset of name, visibility and configuration.",
  });
