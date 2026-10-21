import { z } from "zod";
import { isAiError } from "../ai/errors";
import { wrapUntrusted } from "../ai/prompt";
import { loadConnectorTools } from "../ai-connectors/agent-tools";
import {
  DEFAULT_WEB_RESULTS,
  MAX_WEB_QUERY_CHARS,
  MAX_WEB_RESULTS,
  webSearch,
  webSearchAllowed,
} from "../ai-web-search";
import { type ToolDef, ToolError } from "./tools";

// The tools that reach outside Margaya, offered only to agents an admin
// gave web access: web search (when the instance has a search provider and
// the workspace turned it on) and the workspace's MCP connectors (shared
// ones and the run's person's own). Loading them never fails a run: a
// connector that doesn't answer is simply left out.

/** web_search: only the query leaves Margaya; results are untrusted. */
export const WEB_SEARCH: ToolDef = {
  name: "web_search",
  description:
    "Search the public web. Send a short query with no private workspace details; results (title, address, snippet) come back inside <untrusted> blocks.",
  risk: "read",
  requires: {},
  schema: z
    .object({
      query: z.string().trim().min(1).max(MAX_WEB_QUERY_CHARS),
      max: z.number().int().min(1).max(MAX_WEB_RESULTS).optional(),
    })
    .strict(),
  async read(ctx, args) {
    const input = args as { query: string; max?: number };
    try {
      const results = await webSearch({
        query: input.query,
        workspaceId: ctx.workspaceId,
        max: input.max ?? DEFAULT_WEB_RESULTS,
      });
      if (results.length === 0) return "No results.";
      return results
        .map((result) =>
          wrapUntrusted({
            source: `web:${result.url}`,
            text: `${result.title}\n${result.url}\n${result.snippet}`,
            maxChars: 1_000,
          }),
        )
        .join("\n");
    } catch (error) {
      if (isAiError(error)) {
        throw new ToolError(`Web search is unavailable (${error.code}).`);
      }
      throw error;
    }
  },
};

export async function outsideTools(input: {
  workspaceId: string;
  principalUserId: string;
}): Promise<ToolDef[]> {
  const [search, connectors] = await Promise.all([
    webSearchAllowed(input.workspaceId).catch(() => false),
    loadConnectorTools(input).catch((error) => {
      console.error("agents: could not load connector tools", {
        error: error instanceof Error ? error.name : "unknown",
      });
      return [] as ToolDef[];
    }),
  ]);
  return [...(search ? [WEB_SEARCH] : []), ...connectors];
}
