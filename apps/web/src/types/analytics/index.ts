import type { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";

// Analytics requests and results (GET/POST /api/analytics/*), inferred from
// the typed client. The pure helpers in lib/analytics build on these.

type AnalyticsApi = (typeof client)["analytics"];

type ChartEndpoint = AnalyticsApi["chart"]["$post"];
type TrendEndpoint = AnalyticsApi["trend"]["$post"];
type OverviewEndpoint = AnalyticsApi["overview"]["$get"];
type CyclesEndpoint = AnalyticsApi["cycles"]["$get"];
type ModulesEndpoint = AnalyticsApi["modules"]["$get"];
type IntakeEndpoint = AnalyticsApi["intake"]["$get"];

export type AnalyticsChartRequest = InferRequestType<ChartEndpoint>["json"];
export type AnalyticsChartResult = InferResponseType<ChartEndpoint, 200>;
export type AnalyticsBucket = AnalyticsChartResult["buckets"][number];
export type AnalyticsSegment = AnalyticsChartResult["segments"][number];
export type AnalyticsMeta = AnalyticsChartResult["meta"];

export type AnalyticsTrendRequest = InferRequestType<TrendEndpoint>["json"];
export type AnalyticsTrendResult = InferResponseType<TrendEndpoint, 200>;
export type AnalyticsTrendPoint = AnalyticsTrendResult["series"][number];

export type AnalyticsScopeQuery = InferRequestType<OverviewEndpoint>["query"];
export type AnalyticsOverview = InferResponseType<OverviewEndpoint, 200>;

export type AnalyticsCycles = InferResponseType<CyclesEndpoint, 200>;
export type AnalyticsCycleRow = AnalyticsCycles["rows"][number];
export type AnalyticsVelocityPoint = NonNullable<
  AnalyticsCycles["velocity"]
>[number];

export type AnalyticsModules = InferResponseType<ModulesEndpoint, 200>;
export type AnalyticsModuleRow = AnalyticsModules["rows"][number];

export type AnalyticsIntakeQuery = InferRequestType<IntakeEndpoint>["query"];
export type AnalyticsIntake = InferResponseType<IntakeEndpoint, 200>;

export type AnalyticsDimension = AnalyticsChartRequest["xAxis"];
export type AnalyticsMetric = NonNullable<AnalyticsChartRequest["metric"]>;
export type AnalyticsDateBucket = AnalyticsTrendRequest["bucket"];

/** The fields every task-set request shares (scope, filters, context). */
export type AnalyticsTaskSet = Pick<
  AnalyticsChartRequest,
  "workspaceId" | "scope" | "filters" | "archived" | "showSubTasks" | "context"
>;

/** The project-scoped GET routes take the same query. */
export type AnalyticsScopeParams = {
  workspaceId: string;
  projectIds?: readonly string[];
  timeZone?: string;
};
