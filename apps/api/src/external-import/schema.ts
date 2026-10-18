import { MARGAYA_PRIORITIES } from "../jira-import/mapping";
import { z } from "../openapi";
import { EXTERNAL_SOURCES } from "./types";

// JSON escaping grows the file text (quotes, newlines); bound the body
// generously and check the file itself against its source's limit.
export const EXTERNAL_IMPORT_BODY_BYTES = 24 * 1024 * 1024;

export const externalImportParams = z.object({
  source: z.enum(EXTERNAL_SOURCES).openapi({
    description:
      "trello (board JSON export), linear (CSV export) or asana (CSV export).",
  }),
  projectId: z.string(),
});

const fileFields = {
  content: z.string().min(1).openapi({
    description:
      "The export's text: Trello's board JSON (at most 10 MiB), or Linear's or Asana's CSV (at most 5 MiB). At most 5,000 items.",
  }),
  timeZone: z.string().max(64).optional().openapi({
    description:
      "IANA time zone for dates written without an offset (Asana's calendar days). Defaults to UTC.",
    example: "Europe/Berlin",
  }),
};

export const externalPreviewBody = z.object(fileFields);

export const externalImportOptions = z.object({
  statusMap: z.record(z.string(), z.string()).optional().openapi({
    description:
      "Status (Trello list, Linear status, Asana section) → column slug (or `planned`). Statuses left out use the suggested match.",
  }),
  priorityMap: z
    .record(z.string(), z.enum(MARGAYA_PRIORITIES))
    .optional()
    .openapi({
      description:
        "Source priority → Margaya priority. Priorities left out use the suggested match.",
    }),
  mode: z.enum(["skip", "update"]).default("skip").openapi({
    description:
      "What to do with items imported before (matched by their id): skip them, or update them (needs task:update).",
  }),
  importComments: z.boolean().default(true).openapi({
    description:
      "Import comments (Trello) attributed to their authors. Needs workspace:manage_settings; skipped with a warning otherwise.",
  }),
});

export const externalImportBody = z.object({
  ...fileFields,
  options: externalImportOptions.default({
    mode: "skip",
    importComments: true,
  }),
});

export type ExternalImportOptions = z.infer<typeof externalImportOptions>;
