import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Whiteboard AI: proposals only. The API writes nothing; the editor previews
// the answer and writes it to the board when the person accepts.

type WhiteboardAiClient = (typeof client)["ai"]["whiteboard"][":id"];

export type WhiteboardBrainstormRequest = InferRequestType<
  WhiteboardAiClient["brainstorm"]["$post"]
>["json"];
export type WhiteboardGroupRequest = InferRequestType<
  WhiteboardAiClient["group"]["$post"]
>["json"];
export type WhiteboardSummarizeRequest = InferRequestType<
  WhiteboardAiClient["summarize"]["$post"]
>["json"];

export type WhiteboardAiIdeas = InferResponseType<
  WhiteboardAiClient["brainstorm"]["$post"],
  200
>;
export type WhiteboardAiGroups = InferResponseType<
  WhiteboardAiClient["group"]["$post"],
  200
>;
export type WhiteboardAiSummary = InferResponseType<
  WhiteboardAiClient["summarize"]["$post"],
  200
>;

async function ok<T>(response: {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<T>;
}): Promise<T> {
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function brainstormWhiteboard(input: {
  whiteboardId: string;
  json: WhiteboardBrainstormRequest;
}): Promise<WhiteboardAiIdeas> {
  return ok<WhiteboardAiIdeas>(
    await client.ai.whiteboard[":id"].brainstorm.$post({
      param: { id: input.whiteboardId },
      json: input.json,
    }),
  );
}

export async function groupWhiteboardNotes(input: {
  whiteboardId: string;
  json: WhiteboardGroupRequest;
}): Promise<WhiteboardAiGroups> {
  return ok<WhiteboardAiGroups>(
    await client.ai.whiteboard[":id"].group.$post({
      param: { id: input.whiteboardId },
      json: input.json,
    }),
  );
}

export async function summarizeWhiteboard(input: {
  whiteboardId: string;
  json: WhiteboardSummarizeRequest;
}): Promise<WhiteboardAiSummary> {
  return ok<WhiteboardAiSummary>(
    await client.ai.whiteboard[":id"].summarize.$post({
      param: { id: input.whiteboardId },
      json: input.json,
    }),
  );
}
