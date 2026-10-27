import type { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";

type TemplateRoutes = (typeof client)["task-template"];

export type TaskTemplate = InferResponseType<
  TemplateRoutes["project"][":projectId"]["$get"],
  200
>[number];

export type CreateTaskTemplateInput = InferRequestType<
  TemplateRoutes["$post"]
>["json"];

export type UpdateTaskTemplateInput = InferRequestType<
  TemplateRoutes[":id"]["$patch"]
>["json"];

export type ApplyTaskTemplateInput = InferRequestType<
  TemplateRoutes[":id"]["apply"]["$post"]
>["json"];

export type AppliedTaskTemplate = InferResponseType<
  TemplateRoutes[":id"]["apply"]["$post"],
  200
>;
