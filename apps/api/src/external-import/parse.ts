import { HTTPException } from "hono/http-exception";
import { resolveTimeZone } from "../jira-import/dates";
import { MAX_IMPORT_TASKS } from "../task/import-extras";
import { readAsanaCsv } from "./asana";
import { readLinearCsv } from "./linear";
import { readTrelloExport } from "./trello";
import { type ExternalSource, type ParsedExport, SOURCE_LABELS } from "./types";

const MIB = 1024 * 1024;

/** Largest export file per source: Trello's JSON carries its activity too. */
export const MAX_EXPORT_BYTES: Record<ExternalSource, number> = {
  trello: 10 * MIB,
  linear: 5 * MIB,
  asana: 5 * MIB,
};

const WRONG_FORMAT: Record<ExternalSource, string> = {
  trello:
    "This isn't a Trello board export: it has no cards and lists. Export the board as JSON.",
  linear:
    "This isn't a Linear CSV export: it needs the ID, Title and Status columns",
  asana:
    "This isn't an Asana CSV export: it needs the Task ID and Name columns",
};

function readExport(
  source: ExternalSource,
  content: string,
  timeZone: string,
):
  | { ok: true; parsed: ParsedExport }
  | { ok: false; error: "empty" | "unreadable" | "wrongFormat" } {
  if (source === "trello") {
    const read = readTrelloExport(content);
    if (read.ok) return read;
    return {
      ok: false,
      error:
        read.error === "notJson"
          ? "unreadable"
          : read.error === "notTrello"
            ? "wrongFormat"
            : "empty",
    };
  }
  const read =
    source === "linear"
      ? readLinearCsv(content, timeZone)
      : readAsanaCsv(content, timeZone);
  if (read.ok) return read;
  return {
    ok: false,
    error: read.error === "notCsv" ? "unreadable" : read.error,
  };
}

/** Reads an uploaded export, enforcing the file size and item limits. */
export function parseExternalExport(
  source: ExternalSource,
  content: string,
  timeZone: string | undefined,
) {
  const maxBytes = MAX_EXPORT_BYTES[source];
  if (Buffer.byteLength(content, "utf8") > maxBytes) {
    throw new HTTPException(413, {
      message: `The file is larger than ${maxBytes / MIB} MiB. Export fewer items per file.`,
    });
  }
  const zone = resolveTimeZone(timeZone);
  const read = readExport(source, content, zone);
  if (!read.ok) {
    throw new HTTPException(400, {
      message:
        read.error === "empty"
          ? "The file has nothing to import"
          : read.error === "wrongFormat"
            ? WRONG_FORMAT[source]
            : source === "trello"
              ? "This file can't be read as JSON"
              : "This file can't be read as CSV",
    });
  }
  if (read.parsed.items.length > MAX_IMPORT_TASKS) {
    throw new HTTPException(400, {
      message: `The file has more than ${MAX_IMPORT_TASKS.toLocaleString("en-US")} ${SOURCE_LABELS[source]} items. Export fewer items per file.`,
    });
  }
  return { ...read.parsed, timeZone: zone };
}
