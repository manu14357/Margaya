import type { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";

export type Module = InferResponseType<
  (typeof client)["module"]["project"][":projectId"]["$get"],
  200
>[number];

export type ModuleStatus = Module["status"];

export type ModuleCounts = Module["counts"];

export type ModuleDetail = InferResponseType<
  (typeof client)["module"][":id"]["$get"],
  200
>;

export type ModuleLink = ModuleDetail["links"][number];

export type ModuleMember = ModuleDetail["members"][number];

export type ModuleProgress = InferResponseType<
  (typeof client)["module"][":id"]["progress"]["$get"],
  200
>;

export type ModuleChart = NonNullable<ModuleProgress["chart"]>;

export type ModuleTaskMapEntry = InferResponseType<
  (typeof client)["module"]["project"][":projectId"]["task-map"]["$get"],
  200
>[number];

export type TaskModuleRef = InferResponseType<
  (typeof client)["module"]["task"][":taskId"]["$get"],
  200
>[number];

export type ModuleTaskChange = InferResponseType<
  (typeof client)["module"][":id"]["tasks"]["$post"],
  200
>;

export type ModuleListView = "active" | "archived";
