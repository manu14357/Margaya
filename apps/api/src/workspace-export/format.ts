// The whole-workspace archive, version 1. This is a published format: people
// keep these files and write scripts against them. Add keys freely; renaming or
// removing one needs a new version, here and in the user documentation
// (apps/docs/core/functional/export-workspace.mdx).

export const WORKSPACE_EXPORT_SCHEMA = "margaya.workspace-export.v1";
/** tasks.json keeps the task export's documented JSON shape. */
export const TASK_DOCUMENT_SCHEMA = "margaya.task-export.v1";

/** What an archive never holds. Listed in its manifest and README. */
export const EXCLUDED_DATA = [
  "Secrets: passwords, sessions, API keys, webhook and integration secrets, SSO and SCIM credentials, AI provider keys, public link tokens",
  "Private pages (ownerless ones are included: workspace managers can see them)",
  "Projects the requester may not see",
  "Anything in the trash, task drafts, and intake requests still in triage",
  "Activity history other than comments, page version history, and individual time entries",
  "Notifications, saved views, templates, automations, webhooks and integrations",
] as const;

export const WORKSPACE_EXPORT_README = `# Margaya workspace export

Format: ${WORKSPACE_EXPORT_SCHEMA}. Every data file is UTF-8 JSON, and times are
ISO 8601 in UTC.

| Path | Contains |
| --- | --- |
| manifest.json | The format, when and by whom this was exported, counts, and what is left out |
| workspace.json | Workspace settings, members with their roles, teams, role permissions and labels |
| projects/<project>/project.json | Project settings, columns, members, custom fields, cycles, modules and estimates |
| projects/<project>/tasks.json | Every task of the project (${TASK_DOCUMENT_SCHEMA}) with all its comments, newest first (a reply has its parent comment as parentId) |
| pages/pages.json | Pages as Markdown, with their comments |
| files/index.json | Every stored file: what it belongs to, and its path in this archive |
| files/<id>/<name> | The files themselves, under the id in files/index.json |

In files/index.json, "path" is null when the export was made without files, and
"missing" is true when storage no longer had the file. Task descriptions, comments
and pages link to files by their original address; find the file in files/index.json
by its id. A file's original name is in files/index.json too.

Left out on purpose:

${EXCLUDED_DATA.map((item) => `- ${item}`).join("\n")}

This archive holds your workspace's data, including member email addresses. Keep it
somewhere safe.
`;
