import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { ok } from "./ai";

// 👍 / 👎 on an AI answer. Only the rating, an optional reason and the model
// are stored, never the prompt or the answer.

export type AiFeedbackInput = InferRequestType<
  (typeof client)["ai"]["feedback"]["$post"]
>["json"];

export async function sendAiFeedback(input: AiFeedbackInput) {
  return ok(await client.ai.feedback.$post({ json: input }));
}
