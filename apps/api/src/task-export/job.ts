import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { type taskExportTable, workspaceTable } from "../database/schema";
import { hiddenProjectIds } from "../project/visibility";
import { sanitizePathSegment } from "../storage/s3";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import {
  countExportTasks,
  type ExportProject,
  type ExportTask,
  exportTaskPages,
  loadCustomFieldDefinitions,
  loadExportProjects,
} from "./collect";
import {
  customFieldColumns,
  exportHeader,
  exportRow,
  taskJson,
} from "./columns";
import { CSV_BOM, csvLine } from "./encoders/csv";
import { JsonTaskDocument } from "./encoders/json";
import {
  buildWorkbook,
  sheetNames,
  XLSX_CONTENT_TYPE,
  XlsxSheet,
} from "./encoders/xlsx";
import { buildZip } from "./encoders/zip";
import { exportLimits } from "./settings";

// Builds one export's file: who may still read it, which projects remain,
// the task cap, then encoding against a byte budget, and packaging.
// Storing the file and completing the row are the runner's.

export type TaskExportRow = typeof taskExportTable.$inferSelect;

/** A failure whose message is safe to show the requester. */
export class ExportFailure extends Error {}

export const EXPORT_FAILED = "Something went wrong while exporting. Try again.";
export const REQUESTER_GONE =
  "The requester no longer has access to this workspace";
export const PROJECTS_GONE = "The selected projects no longer exist";
export const EXPORT_TOO_LARGE =
  "This export is too large. Choose fewer projects.";

export function tooManyTasksMessage(count: number): string {
  const format = (n: number) => n.toLocaleString("en-US");
  return `This export has ${format(count)} tasks. The limit is ${format(exportLimits.maxTasks)}; choose fewer projects.`;
}

export const EXPORT_CONTENT_TYPES = {
  csv: "text/csv; charset=utf-8",
  json: "application/json",
  xlsx: XLSX_CONTENT_TYPE,
  zip: "application/zip",
} as const;

export type BuiltExport = {
  body: Buffer;
  fileName: string;
  contentType: string;
  taskCount: number;
};

type Unit = { projects: ExportProject[]; customColumns: string[] };

/** Counts encoded bytes and stops the export at the uncompressed cap. */
class ByteBudget {
  private total = 0;

  add(bytes: number): void {
    this.total += bytes;
    if (this.total > exportLimits.maxUncompressedBytes) {
      throw new ExportFailure(EXPORT_TOO_LARGE);
    }
  }
}

class Output {
  private readonly chunks: Buffer[] = [];

  constructor(private readonly budget: ByteBudget) {}

  write(text: string): void {
    const chunk = Buffer.from(text, "utf8");
    this.budget.add(chunk.length);
    this.chunks.push(chunk);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

async function assertRequesterAccess(row: TaskExportRow): Promise<void> {
  if (!row.requestedBy) throw new ExportFailure(REQUESTER_GONE);
  try {
    await validateWorkspaceAccess(row.requestedBy, row.workspaceId);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw new ExportFailure(REQUESTER_GONE);
    }
    throw error;
  }
}

async function* unitTasks(
  row: TaskExportRow,
  unit: Unit,
): AsyncGenerator<ExportTask> {
  for (const project of unit.projects) {
    for await (const page of exportTaskPages(
      row.workspaceId,
      project,
      row.includeArchived,
    )) {
      yield* page;
    }
  }
}

function projectRef(project: ExportProject) {
  return { id: project.id, name: project.name, slug: project.slug };
}

/** `{base}-tasks-{date}.{ext}` with a sanitized base. */
export function exportFileName(base: string, date: Date, ext: string) {
  return `${sanitizePathSegment(base)}-tasks-${date.toISOString().slice(0, 10)}.${ext}`;
}

/** ZIP entry names `{projectSlug}-tasks.{ext}`, unique within the archive. */
export function entryNames(projects: readonly ExportProject[], ext: string) {
  const used = new Set<string>();
  return projects.map((project) => {
    const base = sanitizePathSegment(project.slug);
    let name = `${base}-tasks.${ext}`;
    for (let n = 2; used.has(name); n += 1) name = `${base}-${n}-tasks.${ext}`;
    used.add(name);
    return name;
  });
}

/** Builds the file of a claimed export. Throws ExportFailure for known limits. */
export async function buildExport(
  row: TaskExportRow,
  now: Date,
): Promise<BuiltExport> {
  await assertRequesterAccess(row);

  // Re-checked at run time: projects restricted since the request, or that
  // the requester left, are not exported.
  const hidden = row.requestedBy
    ? new Set(await hiddenProjectIds(row.requestedBy, row.workspaceId))
    : new Set<string>();
  const projects = await loadExportProjects(
    row.workspaceId,
    row.projectIds.filter((id) => !hidden.has(id)),
  );
  if (projects.length === 0) throw new ExportFailure(PROJECTS_GONE);

  const total = await countExportTasks(
    projects.map((project) => project.id),
    row.includeArchived,
  );
  if (total > exportLimits.maxTasks) {
    throw new ExportFailure(tooManyTasksMessage(total));
  }

  const [workspace] = await db
    .select({
      id: workspaceTable.id,
      name: workspaceTable.name,
      slug: workspaceTable.slug,
    })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, row.workspaceId))
    .limit(1);
  // Deleting the workspace also deletes this row; nothing left to report.
  if (!workspace) throw new ExportFailure(EXPORT_FAILED);

  const split = row.splitByProject && projects.length > 1;
  const groups = split ? projects.map((project) => [project]) : [projects];
  const units: Unit[] = [];
  for (const unitProjects of groups) {
    units.push({
      projects: unitProjects,
      customColumns: customFieldColumns(
        await loadCustomFieldDefinitions(unitProjects),
      ),
    });
  }

  const budget = new ByteBudget();
  let taskCount = 0;
  const baseName =
    projects.length === 1 ? (projects[0]?.slug ?? "") : workspace.slug;

  if (row.format === "xlsx") {
    const names = split
      ? sheetNames(projects.map((project) => project.name))
      : ["Tasks"];
    const sheets: XlsxSheet[] = [];
    for (const [index, unit] of units.entries()) {
      const sheet = new XlsxSheet(
        names[index] ?? "Tasks",
        exportHeader(unit.customColumns),
      );
      for await (const task of unitTasks(row, unit)) {
        budget.add(sheet.addRow(exportRow(task, unit.customColumns)));
        taskCount += 1;
      }
      sheets.push(sheet);
    }
    return {
      body: buildWorkbook(sheets, now),
      fileName: exportFileName(baseName, now, "xlsx"),
      contentType: EXPORT_CONTENT_TYPES.xlsx,
      taskCount,
    };
  }

  const files: Buffer[] = [];
  for (const unit of units) {
    const output = new Output(budget);
    if (row.format === "csv") {
      output.write(`${CSV_BOM}${csvLine(exportHeader(unit.customColumns))}`);
      for await (const task of unitTasks(row, unit)) {
        output.write(csvLine(exportRow(task, unit.customColumns)));
        taskCount += 1;
      }
    } else {
      const document = new JsonTaskDocument({
        schema: "margaya.task-export.v1",
        exportedAt: now.toISOString(),
        workspace,
        projects: unit.projects.map(projectRef),
        options: { includeArchived: row.includeArchived },
      });
      output.write(document.head());
      for await (const task of unitTasks(row, unit)) {
        output.write(document.task(taskJson(task)));
        taskCount += 1;
      }
      output.write(document.tail());
    }
    files.push(output.toBuffer());
  }

  if (!split) {
    return {
      body: files[0] ?? Buffer.alloc(0),
      fileName: exportFileName(baseName, now, row.format),
      contentType: EXPORT_CONTENT_TYPES[row.format],
      taskCount,
    };
  }
  const names = entryNames(projects, row.format);
  return {
    body: buildZip(
      files.map((data, index) => ({ name: names[index] ?? "", data })),
      now,
    ),
    fileName: exportFileName(workspace.slug, now, "zip"),
    contentType: EXPORT_CONTENT_TYPES.zip,
    taskCount,
  };
}
