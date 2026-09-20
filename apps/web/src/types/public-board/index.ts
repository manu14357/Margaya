import type { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";

type BoardRoute = (typeof client)["public-board"][":token"];
type TaskRoute = BoardRoute["tasks"][":number"];

export type PublicBoard = InferResponseType<BoardRoute["$get"], 200>;

export type PublicBoardViewer = PublicBoard["viewer"];

export type PublicBoardColumn = PublicBoard["columns"][number];

export type PublicBoardLabel = PublicBoard["labels"][number];

export type PublicSort = PublicBoard["sorts"][number];

export type PublicLayout = PublicBoard["board"]["defaultLayout"];

export type PublicTaskPage = InferResponseType<
  BoardRoute["tasks"]["$get"],
  200
>;

export type PublicTaskListQuery = NonNullable<
  InferRequestType<BoardRoute["tasks"]["$get"]>["query"]
>;

export type PublicTaskRow = PublicTaskPage["tasks"][string];

export type PublicTaskDetail = InferResponseType<TaskRoute["$get"], 200>;

export type PublicVoteState = InferResponseType<TaskRoute["vote"]["$put"], 200>;

export type PublicReactionGroup = InferResponseType<
  TaskRoute["reactions"][":emoji"]["$put"],
  200
>[number];

export type PublicCommentPage = InferResponseType<
  TaskRoute["comments"]["$get"],
  200
>;

export type PublicComment = PublicCommentPage["items"][number];

export type PublicRequestPage = InferResponseType<
  BoardRoute["requests"]["mine"]["$get"],
  200
>;

export type PublicRequest = PublicRequestPage["items"][number];

export type PublicRequestStatus = PublicRequest["status"];
