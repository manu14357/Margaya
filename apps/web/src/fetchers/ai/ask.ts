import type { AiStreamHandlers, client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { streamAiRoute } from "./ai";

// Ask (Workspace Memory): a question in, a cited answer streamed back. The
// stream's `meta` event carries `sources`; `done` carries `citations` and
// `noResults` (see apps/api/src/ai-ask).

export type AskRequest = InferRequestType<
  (typeof client)["ai"]["ask"]["$post"]
>["json"];

export type AskSourceKind = "task" | "page" | "comment" | "web";

export type AskSource = {
  /** The citation token without brackets: "T:WEB-12". */
  ref: string;
  kind: AskSourceKind;
  id: string;
  title: string;
  /**
   * Web app path; opening it re-checks access. A web search result ("W:1")
   * has an external http(s) URL instead, opened in a new tab.
   */
  url: string;
  projectId: string | null;
  updatedAt: string | null;
};

const KINDS: readonly string[] = ["task", "page", "comment", "web"];

function isExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** The sources of a `meta` event, keeping only well-formed entries. */
export function readAskSources(value: unknown): AskSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is AskSource =>
      typeof item === "object" &&
      item !== null &&
      typeof item.ref === "string" &&
      KINDS.includes(item.kind) &&
      typeof item.id === "string" &&
      typeof item.title === "string" &&
      typeof item.url === "string" &&
      // In-app paths only, except web search results, which link out.
      (item.kind === "web"
        ? isExternalUrl(item.url)
        : item.url.startsWith("/dashboard/")),
  );
}

export function streamAsk(
  body: AskRequest,
  options: AiStreamHandlers & { signal?: AbortSignal },
) {
  return streamAiRoute("/ai/ask", body, options);
}
