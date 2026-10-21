// Structured tool output (MCP 2025-06-18 and later). Every successful tool
// result carries its JSON as `structuredContent` beside the text block that
// older clients read. Arrays are wrapped as `{ items }`, because handshake-era
// revisions require structured content to be an object. Tools whose shape is
// stable also declare an output schema; the schemas are loose (extra fields
// pass) so API additions never break a client. This file is kept
// byte-identical in apps/api/src/mcp/output.ts (the HTTP MCP server) and
// packages/mcp/src/tools/output.ts (the stdio package).
import { z } from "zod";

/** The structured form of a tool's JSON result, or undefined for text. */
export function structuredOf(
  data: unknown,
): Record<string, unknown> | undefined {
  if (Array.isArray(data)) return { items: data };
  if (data !== null && typeof data === "object") {
    return data as Record<string, unknown>;
  }
  return undefined;
}

const task = z.looseObject({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
});

const project = z.looseObject({
  id: z.string(),
  workspaceId: z.string(),
  slug: z.string(),
  name: z.string(),
});

const column = z.looseObject({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

const OUTPUT_SCHEMAS: Record<string, z.ZodObject> = {
  get_task: task,
  create_task: task,
  get_project: project,
  create_project: project,
  list_projects: z.object({ items: z.array(project) }),
  list_project_columns: z.object({ items: z.array(column) }),
};

/** The declared output schema of a tool, when its shape is stable. */
export function mcpToolOutputSchema(name: string): z.ZodObject | undefined {
  return OUTPUT_SCHEMAS[name];
}
