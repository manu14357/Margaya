import { z } from "../openapi";
import { MARGAYA_PRIORITIES } from "./mapping";

export const MAX_JIRA_FILE_BYTES = 5 * 1024 * 1024;
// JSON escaping can grow the file text (quotes, newlines); bound the body
// generously and check the file itself against MAX_JIRA_FILE_BYTES.
export const JIRA_IMPORT_BODY_BYTES = 16 * 1024 * 1024;

export const jiraProjectParam = z.object({ projectId: z.string() });

const fileFields = {
  content: z.string().min(1).openapi({
    description:
      "The text of Jira's CSV export (Export → CSV (all fields)), at most 5 MiB and 5,000 issues.",
  }),
  timeZone: z.string().max(64).optional().openapi({
    description:
      "IANA time zone the export's dates are read in (Jira writes local times without an offset). Defaults to UTC.",
    example: "Europe/Berlin",
  }),
};

export const jiraPreviewBody = z.object(fileFields);

export const jiraImportOptions = z.object({
  statusMap: z.record(z.string(), z.string()).optional().openapi({
    description:
      "Jira status name → column slug (or `planned`). Statuses left out use the suggested match.",
  }),
  priorityMap: z
    .record(z.string(), z.enum(MARGAYA_PRIORITIES))
    .optional()
    .openapi({
      description:
        "Jira priority name → Margaya priority. Priorities left out use the suggested match.",
    }),
  mode: z.enum(["skip", "update"]).default("skip").openapi({
    description:
      "What to do with issues imported before (matched by issue key): skip them, or update them (needs task:update).",
  }),
  issueTypeAsLabel: z.boolean().default(true).openapi({
    description: "Add the issue type (Bug, Story…) as a label.",
  }),
  importComments: z.boolean().default(true).openapi({
    description:
      "Import comments attributed to their Jira authors. Needs workspace:manage_settings; skipped with a warning otherwise.",
  }),
  sprintsAsCycles: z.boolean().default(false).openapi({
    description:
      "Put each issue in a cycle named after its last sprint, creating missing cycles. Needs the project's Cycles feature and cycle:create.",
  }),
  componentsAsModules: z.boolean().default(false).openapi({
    description:
      "Add each issue to modules named after its components, creating missing modules. Needs the project's Modules feature and module:create.",
  }),
});

export const jiraImportBody = z.object({
  ...fileFields,
  options: jiraImportOptions.default({
    mode: "skip",
    issueTypeAsLabel: true,
    importComments: true,
    sprintsAsCycles: false,
    componentsAsModules: false,
  }),
});

export type JiraImportOptions = z.infer<typeof jiraImportOptions>;
