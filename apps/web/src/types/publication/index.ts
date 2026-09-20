import type { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";

type ProjectRoute = (typeof client)["publication"]["project"][":projectId"];

export type ProjectPublication = InferResponseType<ProjectRoute["$get"], 200>;

export type PublicationSettingsPatch = NonNullable<
  InferRequestType<ProjectRoute["$patch"]>["json"]
>;

export type PublicationLayout = ProjectPublication["defaultLayout"];

export type PublicCommentModerationPage = InferResponseType<
  ProjectRoute["comments"]["$get"],
  200
>;

export type PublicCommentModerationItem =
  PublicCommentModerationPage["items"][number];

export type PublicAuthorKind = NonNullable<
  PublicCommentModerationItem["author"]
>["kind"];

export type PublicBoardBlock = InferResponseType<
  ProjectRoute["blocks"]["$get"],
  200
>[number];

export type TaskVoteSummary = InferResponseType<
  (typeof client)["publication"]["task"][":taskId"]["votes"]["$get"],
  200
>;

export type CommentVisibility = "internal" | "public";
