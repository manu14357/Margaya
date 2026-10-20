import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Natural-language task filters: a sentence becomes the task query's filter
// tree, which the toolbar applies like any filter the person picks.

type FiltersClient = (typeof client)["ai"]["filters"];

export type ParseFilterRequest = InferRequestType<
  FiltersClient["parse"]["$post"]
>["json"];
export type ParsedFilter = InferResponseType<
  FiltersClient["parse"]["$post"],
  200
>;

export async function parseTaskFilter(
  body: ParseFilterRequest,
): Promise<ParsedFilter> {
  const response = await client.ai.filters.parse.$post({ json: body });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()) as ParsedFilter;
}
