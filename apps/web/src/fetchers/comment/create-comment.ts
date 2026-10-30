import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateCommentRequest = InferRequestType<
  (typeof client)["activity"]["comment"]["$post"]
>["json"] & {
  /** Public comments also show on the project's public board. */
  visibility?: "internal" | "public";
};

async function createComment({
  taskId,
  comment,
  visibility,
  parentId,
}: CreateCommentRequest) {
  // Only the comment route takes a visibility; both create the same row.
  // `parentId` makes it a reply in that comment's thread.
  const response =
    visibility === "public"
      ? await client.comment[":taskId"].$post({
          param: { taskId },
          json: { content: comment, visibility, parentId },
        })
      : await client.activity.comment.$post({
          json: {
            taskId,
            comment,
            parentId,
          },
        });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();

  return data;
}

export default createComment;
