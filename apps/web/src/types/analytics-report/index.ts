import type { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";

// Saved analytics reports (/api/analytics-report), inferred from the typed
// client.

type ReportApi = (typeof client)["analytics-report"];

export type AnalyticsReport = InferResponseType<ReportApi[":id"]["$get"], 200>;

export type AnalyticsReportConfig = AnalyticsReport["config"];

export type AnalyticsReportVisibility = AnalyticsReport["visibility"];

export type CreateAnalyticsReportInput = InferRequestType<
  ReportApi["$post"]
>["json"];

export type UpdateAnalyticsReportInput = InferRequestType<
  ReportApi[":id"]["$patch"]
>["json"];
