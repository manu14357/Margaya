import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { responseError } from "./response-error";

export type AddWhiteboardElementsInput = InferRequestType<
  (typeof client)["whiteboard"][":id"]["elements"]["$post"]
>["json"];

/** The board's elements and settings: the live room's, else the stored copy. */
export async function getWhiteboardContent(
  whiteboardId: string,
  signal?: AbortSignal,
) {
  const response = await client.whiteboard[":id"].content.$get(
    { param: { id: whiteboardId } },
    { init: { signal } },
  );
  if (!response.ok) throw await responseError(response);
  return response.json();
}

/** Adds or replaces elements without a socket (through the room if open). */
export async function addWhiteboardElements(
  whiteboardId: string,
  json: AddWhiteboardElementsInput,
) {
  const response = await client.whiteboard[":id"].elements.$post({
    param: { id: whiteboardId },
    json,
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}
