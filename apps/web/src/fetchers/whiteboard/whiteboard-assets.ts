import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { responseError } from "./response-error";

type AssetsApi = (typeof client)["whiteboard"][":id"]["assets"];

export type WhiteboardAssetUploadInput = InferRequestType<
  AssetsApi["$post"]
>["json"];
export type FinalizeWhiteboardAssetInput = InferRequestType<
  AssetsApi[":assetId"]["finalize"]["$post"]
>["json"];

/** An asset id and where to PUT the image bytes. */
export async function createWhiteboardAssetUpload(
  whiteboardId: string,
  json: WhiteboardAssetUploadInput,
) {
  const response = await client.whiteboard[":id"].assets.$post({
    param: { id: whiteboardId },
    json,
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

/** Checks the uploaded bytes and records the image on the board. */
export async function finalizeWhiteboardAsset(
  whiteboardId: string,
  assetId: string,
  json: FinalizeWhiteboardAssetInput,
) {
  const response = await client.whiteboard[":id"].assets[
    ":assetId"
  ].finalize.$post({
    param: { id: whiteboardId, assetId },
    json,
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}
