import type { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";

export type EstimateList = InferResponseType<
  (typeof client)["estimate"][":projectId"]["$get"],
  200
>;

export type Estimate = EstimateList["estimates"][number];

export type EstimatePoint = Estimate["points"][number];

export type EstimateSystemType = Estimate["type"];

export type EstimateTotals = InferResponseType<
  (typeof client)["estimate"][":projectId"]["totals"]["$post"],
  200
>;

export type EstimateActivateResult = InferResponseType<
  (typeof client)["estimate"][":projectId"][":estimateId"]["activate"]["$post"],
  200
>;

export type EstimatePointDeleteResult = InferResponseType<
  (typeof client)["estimate"][":projectId"][":estimateId"]["points"][":pointId"]["$delete"],
  200
>;
