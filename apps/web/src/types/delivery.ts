import type { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";

// Delivery forecast and risk radar (GET /api/delivery/*), inferred from the
// typed client.

type DeliveryApi = (typeof client)["delivery"];

export type DeliveryScopeType = "cycle" | "module" | "project";

export type DeliveryForecast = InferResponseType<
  DeliveryApi["cycle"][":cycleId"]["forecast"]["$get"],
  200
>;

export type RiskRadar = InferResponseType<
  DeliveryApi["cycle"][":cycleId"]["risks"]["$get"],
  200
>;

export type RiskSignal = RiskRadar["signals"][number];
export type RiskTaskRef = RiskRadar["tasks"][number];

export type HomeRisks = InferResponseType<
  DeliveryApi["home"]["risks"]["$get"],
  200
>;

export type HomeRiskSignal = HomeRisks["signals"][number];
