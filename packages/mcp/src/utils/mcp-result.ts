import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { structuredOf } from "../tools/output.js";

export function textResult(data: unknown, isError = false): CallToolResult {
  const text =
    typeof data === "string" ? data : (JSON.stringify(data, null, 2) ?? "");
  // The same JSON as structured content (output.ts); errors stay text.
  const structuredContent = isError ? undefined : structuredOf(data);
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    ...(structuredContent ? { structuredContent } : {}),
    isError,
  };
}

export function errorResult(message: string): CallToolResult {
  return textResult({ error: message }, true);
}
