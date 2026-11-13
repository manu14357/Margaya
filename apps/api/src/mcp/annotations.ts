// MCP tool annotations: the same safety signals Margaya's own agents use
// (read, write, destructive), so external agents and their hosts can ask
// before destructive calls. This file is kept byte-identical in
// apps/api/src/mcp/annotations.ts (the HTTP MCP server) and
// packages/mcp/src/tools/annotations.ts (the stdio package).

export type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

const READ_ONLY = new Set([
  "whoami",
  "list_workspaces",
  "list_projects",
  "get_project",
  "list_tasks",
  "query_tasks",
  "get_task",
  "list_task_comments",
  "list_workspace_labels",
  "get_task_relations",
  "list_workspace_members",
  "search",
  "list_project_columns",
  "list_task_time_entries",
  "get_time_entry",
  "list_task_activity",
  "list_notifications",
  "list_cycles",
  "get_cycle",
  "list_modules",
  "get_module",
  "list_module_tasks",
  "list_pages",
  "get_page",
  "list_intake_items",
  "get_intake_item",
  "list_task_templates",
  "get_task_recurrence",
  "list_automation_rules",
  "list_project_updates",
  "get_project_update",
  // Computes a draft; saves nothing.
  "draft_project_update",
  "list_agents",
  "get_agent_run",
]);

// Deletes, replacements of whole lists or contents, bulk moves, triage
// decisions that close a request, and anything touching sharing.
const DESTRUCTIVE = new Set([
  "update_project",
  "delete_task",
  "delete_task_comment",
  "delete_label",
  "delete_task_relation",
  "update_task_assignee",
  "set_task_assignees",
  "delete_cycle",
  "update_cycle_tasks",
  "transfer_cycle_tasks",
  "delete_module",
  "update_module_tasks",
  "set_task_modules",
  "delete_module_link",
  "replace_page_content",
  "delete_page",
  "triage_intake_item",
  "delete_intake_item",
  "remove_task_recurrence",
]);

/** The annotations of a tool; unknown names are treated as destructive. */
export function mcpToolAnnotations(name: string): McpToolAnnotations {
  const known =
    READ_ONLY.has(name) ||
    DESTRUCTIVE.has(name) ||
    /^(create|update|set|move|attach|detach|restore|submit|run)_/.test(name);
  const readOnly = READ_ONLY.has(name);
  return {
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && (DESTRUCTIVE.has(name) || !known),
    idempotentHint:
      readOnly || /^(set|update|delete|restore|remove)_/.test(name),
    // Every tool acts on this Margaya instance only.
    openWorldHint: false,
  };
}
