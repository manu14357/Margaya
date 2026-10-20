import { type AiStreamHandlers, client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import { streamAiRoute } from "./ai";

// AI writing (B6): editor block actions, one-click summaries and spec
// drafts. Each streams Markdown back for the person to review; nothing is
// saved by these calls.

type WritingClient = (typeof client)["ai"]["writing"];

export type EditorAssistRequest = InferRequestType<
  WritingClient["assist"]["$post"]
>["json"];
export type EditorAiAction = EditorAssistRequest["action"];
export type AiUiLocale = NonNullable<EditorAssistRequest["language"]>;
export type EditorAiTone = NonNullable<EditorAssistRequest["tone"]>;
export type EditorAiTargetKind = EditorAssistRequest["target"]["kind"];

export type SummarizeRequest = InferRequestType<
  WritingClient["summarize"]["$post"]
>["json"];
export type SummaryKind = SummarizeRequest["kind"];

export type SpecDraftRequest = InferRequestType<
  WritingClient["spec-draft"]["$post"]
>["json"];

export type PageBlockRequest = InferRequestType<
  WritingClient["page-block"]["$post"]
>["json"];
export type PageBlockPreset = PageBlockRequest["preset"];

export type PageTitleRequest = InferRequestType<
  WritingClient["title"]["$post"]
>["json"];

type StreamOptions = AiStreamHandlers & { signal?: AbortSignal };

export function streamEditorAssist(
  body: EditorAssistRequest,
  options: StreamOptions,
) {
  return streamAiRoute("/ai/writing/assist", body, options);
}

export function streamSummary(body: SummarizeRequest, options: StreamOptions) {
  return streamAiRoute("/ai/writing/summarize", body, options);
}

export function streamSpecDraft(
  body: SpecDraftRequest,
  options: StreamOptions,
) {
  return streamAiRoute("/ai/writing/spec-draft", body, options);
}

/** An AI block generated from a page (TL;DR, FAQ, action items, custom). */
export function streamPageBlock(
  body: PageBlockRequest,
  options: StreamOptions,
) {
  return streamAiRoute("/ai/writing/page-block", body, options);
}

/** One suggested title for a page. */
export async function suggestPageTitle(body: PageTitleRequest) {
  const response = await client.ai.writing.title.$post({ json: body });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()) as { title: string };
}
