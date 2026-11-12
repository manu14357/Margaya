import type { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";

type Routes = (typeof client)["instance-admin"];

export type InstanceOverview = InferResponseType<
  Routes["overview"]["$get"],
  200
>;

export type InstanceSettings = InferResponseType<
  Routes["settings"]["$get"],
  200
>;
export type InstanceSettingEntry = InstanceSettings["settings"][number];
export type InstanceDerivedSettings = InstanceSettings["derived"];
export type OAuthProviderId = keyof InstanceDerivedSettings["providers"];
export type InstanceProviderState =
  InstanceDerivedSettings["providers"][OAuthProviderId];

/** `null` clears the saved value; secrets take a non-empty string. */
export type InstanceSettingValue = string | number | boolean | null;
export type InstanceSettingsPatch = Record<string, InstanceSettingValue>;

export type InstanceWorkspacePage = InferResponseType<
  Routes["workspaces"]["$get"],
  200
>;
export type InstanceWorkspace = InstanceWorkspacePage["items"][number];

export type InstancePublicBoardPage = InferResponseType<
  Routes["public-boards"]["$get"],
  200
>;
export type InstancePublicBoard = InstancePublicBoardPage["items"][number];

export type SmtpTestResult = InferResponseType<
  Routes["email"]["test"]["$post"],
  200
>;
export type SmtpTestCode = SmtpTestResult["code"];

export type InstanceAdmin = InferResponseType<
  Routes["admins"]["$get"],
  200
>[number];

export type InstanceUserPage = InferResponseType<Routes["users"]["$get"], 200>;
export type InstanceUser = InstanceUserPage["items"][number];
export type InstanceUserDetail = InferResponseType<
  Routes["users"][":userId"]["$get"],
  200
>;
export type InstanceUserStatus = "all" | "admins" | "banned";

export type InstanceHealth = InferResponseType<Routes["health"]["$get"], 200>;
export type InstanceHealthCheck = InstanceHealth["checks"][number];
export type InstanceJobStatus = InstanceHealth["jobs"][number];
export type InstanceRecentFailure = InstanceHealth["failures"][number];

export type InstanceUpdateStatus = InferResponseType<
  Routes["update-status"]["$get"],
  200
>;
