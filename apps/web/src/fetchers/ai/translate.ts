import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Translate-on-read (B8): a comment, a task description or a page in the
// reader's language. The API caches translations per source and language.

type TranslateClient = (typeof client)["ai"]["translate"];

export type TranslateRequest = InferRequestType<
  TranslateClient["$post"]
>["json"];
export type TranslateKind = TranslateRequest["kind"];
export type Translation = InferResponseType<TranslateClient["$post"], 200>;

export async function translateContent(
  input: TranslateRequest,
): Promise<Translation> {
  const response = await client.ai.translate.$post({ json: input });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
