import type { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";

type AutomationRoutes = (typeof client)["project-automation"][":projectId"];

export type ProjectAutomations = InferResponseType<
  AutomationRoutes["$get"],
  200
>;

export type AutomationPreview = InferResponseType<
  AutomationRoutes["preview"]["$get"],
  200
>;

export type UpdateProjectAutomationsInput = InferRequestType<
  AutomationRoutes["$patch"]
>["json"];

export type AutomationRule = AutomationPreview["rule"];

export type AutoCloseState = ProjectAutomations["autoClose"]["state"];
