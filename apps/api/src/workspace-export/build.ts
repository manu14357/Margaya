import { lstat, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import db from "../database";
import { userTable, workspaceUserTable } from "../database/schema";
import { hiddenProjectIds } from "../project/visibility";
import {
  getPrivateObject,
  sanitizePathSegment,
  storageDriver,
} from "../storage/s3";
import {
  EXPORT_PAGE_SIZE,
  type ExportProject,
  exportTaskPages,
  loadExportProjects,
} from "../task-export/collect";
import { taskJson } from "../task-export/columns";
import { JsonTaskDocument } from "../task-export/encoders/json";
import { ZipFileWriter, ZipLimitError } from "../task-export/encoders/zip-file";
import {
  assertRequesterAccess,
  EXPORT_CONTENT_TYPES,
  EXPORT_FAILED,
  ExportFailure,
  REQUESTER_GONE,
  type TaskExportRow,
} from "../task-export/job";
import { exportLimits } from "../task-export/settings";
import { WORKSPACE_EXPORT_PERMISSIONS } from "../task-export/types";
import {
  builtInRoleStatements,
  customRoleStatements,
} from "../utils/require-workspace-permission";
import {
  countPrivatePages,
  type ExportAsset,
  exportPageBatches,
  loadExportAssets,
  loadProjectDocument,
  loadWorkspaceDocument,
} from "./collect";
import {
  EXCLUDED_DATA,
  TASK_DOCUMENT_SCHEMA,
  WORKSPACE_EXPORT_README,
  WORKSPACE_EXPORT_SCHEMA,
} from "./format";

// Builds a whole-workspace archive on disk, a project and a file at a time, so
// its size costs disk rather than memory. Storing it and completing the row are
// the runner's, which also removes the temporary file.

export const WORKSPACE_EXPORT_TOO_LARGE =
  "This workspace is too large for one export (the limit is 4 GB). Export it without files.";
export const WORKSPACE_EXPORT_TOO_MANY_FILES =
  "This workspace has too many files for one export. Export it without files.";

// A single stalled download must not hold the export queue forever.
const FILE_READ_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_FILE_NAME_LENGTH = 120;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/;

const ARCHIVE_PREFIX = "margaya-workspace-export-";
// A live run writes to its archive as it goes, and stores it within an hour of
// the last write (putPrivateObjectFromFile's timeout). A day without a change
// means the run that made it is gone.
const ABANDONED_ARCHIVE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes the archives crashed runs left in this machine's temp folder once
 * they are a day old, and returns how many. Each instance has its own folder,
 * so each sweeps its own.
 */
export async function sweepAbandonedArchives(now = new Date()) {
  const folder = tmpdir();
  const cutoff = now.getTime() - ABANDONED_ARCHIVE_AGE_MS;
  let removed = 0;
  for (const name of await readdir(folder)) {
    if (!name.startsWith(ARCHIVE_PREFIX) || !name.endsWith(".zip")) continue;
    const file = path.join(folder, name);
    try {
      const stats = await lstat(file);
      if (!stats.isFile() || stats.mtimeMs >= cutoff) continue;
      await rm(file, { force: true });
      removed += 1;
    } catch {
      // Gone already, or another local user's: not this one's to remove.
    }
  }
  return removed;
}

export type BuiltWorkspaceExport = {
  filePath: string;
  sizeBytes: number;
  fileName: string;
  contentType: string;
  taskCount: number;
  fileCount: number;
  missingFileCount: number;
};

/** The queue may run this long after the request: the role is read again. */
async function assertRequesterManagesWorkspace(row: TaskExportRow) {
  if (!row.requestedBy) throw new ExportFailure(REQUESTER_GONE);
  const [user] = await db
    .select({ role: userTable.role })
    .from(userTable)
    .where(eq(userTable.id, row.requestedBy))
    .limit(1);
  if (user?.role === "admin") return;
  const [member] = await db
    .select({ role: workspaceUserTable.role })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, row.workspaceId),
        eq(workspaceUserTable.userId, row.requestedBy),
      ),
    )
    .limit(1);
  const statements = member
    ? ((await customRoleStatements(row.workspaceId, member.role)) ??
      builtInRoleStatements(member.role))
    : null;
  const allowed = Object.entries(WORKSPACE_EXPORT_PERMISSIONS).every(
    ([resource, actions]) =>
      actions.every((action) => statements?.[resource]?.includes(action)),
  );
  if (!allowed) throw new ExportFailure(REQUESTER_GONE);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** One safe folder name per project, unique within the archive. */
export function projectFolders(projects: readonly ExportProject[]): string[] {
  const used = new Set<string>();
  return projects.map((project) => {
    const base = entrySegment(project.slug);
    let name = base;
    for (let n = 2; used.has(name); n += 1) name = `${base}-${n}`;
    used.add(name);
    return name;
  });
}

/**
 * One safe path segment on any operating system: never `.` or `..`, no
 * trailing dot, no name Windows reserves, and short enough to extract.
 */
export function entrySegment(value: string): string {
  const safe = sanitizePathSegment(value)
    .slice(-MAX_FILE_NAME_LENGTH)
    .replace(/^[.-]+|[.-]+$/g, "");
  if (!safe) return "file";
  return WINDOWS_RESERVED_NAME.test(safe) ? `file-${safe}` : safe;
}

/** Storage answered that the object doesn't exist, rather than failing. */
export function isMissingObject(error: unknown): boolean {
  const failure = error as {
    code?: string;
    name?: string;
    $metadata?: { httpStatusCode?: number };
  } | null;
  return (
    failure?.code === "ENOENT" ||
    failure?.name === "NoSuchKey" ||
    failure?.name === "NotFound" ||
    failure?.$metadata?.httpStatusCode === 404
  );
}

/**
 * Every field of a task, whatever its project has turned off: a feature that
 * is off hides its data but keeps it, and this archive is meant to be complete.
 */
function withEveryFeature(project: ExportProject): ExportProject {
  return {
    ...project,
    cyclesEnabled: true,
    modulesEnabled: true,
    estimatesEnabled: true,
    timeTrackingEnabled: true,
  };
}

async function* taskDocument(
  row: TaskExportRow,
  project: ExportProject,
  workspace: { id: string; name: string; slug: string },
  hiddenProjectIds: readonly string[],
  now: Date,
  counts: { tasks: number },
) {
  const document = new JsonTaskDocument({
    schema: TASK_DOCUMENT_SCHEMA,
    exportedAt: now.toISOString(),
    workspace,
    projects: [{ id: project.id, name: project.name, slug: project.slug }],
    options: { includeArchived: true, allComments: true },
  });
  yield document.head();
  for await (const page of exportTaskPages(
    row.workspaceId,
    withEveryFeature(project),
    true,
    hiddenProjectIds,
    EXPORT_PAGE_SIZE,
    null,
  )) {
    for (const task of page) {
      yield document.task(taskJson(task));
      counts.tasks += 1;
    }
  }
  yield document.tail();
}

async function* pageDocument(
  row: TaskExportRow,
  projectIds: readonly string[],
  now: Date,
  counts: { pages: number },
) {
  const document = new JsonTaskDocument(
    { schema: WORKSPACE_EXPORT_SCHEMA, exportedAt: now.toISOString() },
    "pages",
  );
  yield document.head();
  for await (const batch of exportPageBatches(row.workspaceId, projectIds)) {
    for (const page of batch) {
      yield document.task(page);
      counts.pages += 1;
    }
  }
  yield document.tail();
}

type FileRecord = ExportAsset & { path: string | null; missing: boolean };

/** Writes each file into the archive and reports where each one ended up. */
async function writeFiles(
  writer: ZipFileWriter,
  assets: readonly ExportAsset[],
): Promise<FileRecord[]> {
  // Without storage the bytes are out of reach, though the rows remain.
  const reachable = storageDriver() !== "none";
  const records: FileRecord[] = [];
  for (const asset of assets) {
    const entry = `files/${entrySegment(asset.id)}/${entrySegment(asset.filename)}`;
    if (!reachable) {
      records.push({ ...asset, path: null, missing: true });
      continue;
    }
    try {
      const object = await getPrivateObject(asset.objectKey);
      await writer.add(entry, object.body as AsyncIterable<Uint8Array>, {
        compress: false,
        signal: AbortSignal.timeout(FILE_READ_TIMEOUT_MS),
      });
      records.push({ ...asset, path: entry, missing: false });
    } catch (error) {
      // A storage failure must fail the export: otherwise an outage would
      // yield an archive that looks complete and has no files in it.
      if (!isMissingObject(error)) throw error;
      records.push({ ...asset, path: null, missing: true });
    }
  }
  return records;
}

/** Builds the archive of a claimed export into a temporary file. */
export async function buildWorkspaceExport(
  row: TaskExportRow,
  now: Date,
): Promise<BuiltWorkspaceExport> {
  await assertRequesterAccess(row);
  await assertRequesterManagesWorkspace(row);

  const settings = await loadWorkspaceDocument(row.workspaceId);
  // Deleting the workspace also deletes this row; nothing left to report.
  if (!settings) throw new ExportFailure(EXPORT_FAILED);

  const hidden = new Set(
    await hiddenProjectIds(row.requestedBy as string, row.workspaceId),
  );
  const projects = await loadExportProjects(
    row.workspaceId,
    row.projectIds.filter((id) => !hidden.has(id)),
  );
  const projectIds = projects.map((project) => project.id);

  const assets = await loadExportAssets(row.workspaceId, projectIds);
  if (row.includeFiles) {
    // Fail before the work, when the files alone can't fit.
    const total = assets.reduce((sum, asset) => sum + asset.size, 0);
    if (total > exportLimits.maxWorkspaceBytes) {
      throw new ExportFailure(WORKSPACE_EXPORT_TOO_LARGE);
    }
    if (assets.length > exportLimits.maxWorkspaceFiles) {
      throw new ExportFailure(WORKSPACE_EXPORT_TOO_MANY_FILES);
    }
  }

  const { id, name, slug } = settings.workspace;
  // Per run: a crashed run's file stays behind, and the retry can't reuse it.
  // sweepAbandonedArchives removes it later.
  const filePath = path.join(
    tmpdir(),
    `${ARCHIVE_PREFIX}${row.id}-${row.attempts}.zip`,
  );
  const writer = await ZipFileWriter.create(
    filePath,
    now,
    exportLimits.maxWorkspaceBytes,
  );
  const counts = { tasks: 0, pages: 0 };
  try {
    const document = (entry: string, text: string) =>
      writer.add(entry, [text], { compress: true });

    await document("README.md", WORKSPACE_EXPORT_README);
    await document(
      "workspace.json",
      json({ schema: WORKSPACE_EXPORT_SCHEMA, ...settings }),
    );

    const folders = projectFolders(projects);
    const entries: { id: string; slug: string; folder: string }[] = [];
    for (const [index, project] of projects.entries()) {
      const folder = `projects/${folders[index] ?? project.id}`;
      const settingsDocument = await loadProjectDocument(project.id);
      if (!settingsDocument) continue;
      await document(
        `${folder}/project.json`,
        json({ schema: WORKSPACE_EXPORT_SCHEMA, ...settingsDocument }),
      );
      await writer.add(
        `${folder}/tasks.json`,
        taskDocument(
          row,
          project,
          { id, name, slug },
          [...hidden],
          now,
          counts,
        ),
        { compress: true },
      );
      entries.push({ id: project.id, slug: project.slug, folder });
    }

    await writer.add(
      "pages/pages.json",
      pageDocument(row, projectIds, now, counts),
      { compress: true },
    );

    const files: FileRecord[] = row.includeFiles
      ? await writeFiles(writer, assets)
      : assets.map((asset) => ({ ...asset, path: null, missing: false }));
    const missingFileCount = files.filter((file) => file.missing).length;
    const fileCount = files.filter((file) => file.path !== null).length;
    await document(
      "files/index.json",
      json({
        schema: WORKSPACE_EXPORT_SCHEMA,
        // Storage keys are internal, and useless outside this install.
        files: files.map(({ objectKey: _objectKey, ...file }) => file),
      }),
    );

    await document(
      "manifest.json",
      json({
        schema: WORKSPACE_EXPORT_SCHEMA,
        exportedAt: now.toISOString(),
        workspace: { id, name, slug },
        requestedBy: row.requestedBy,
        includeFiles: row.includeFiles,
        counts: {
          projects: entries.length,
          tasks: counts.tasks,
          pages: counts.pages,
          files: fileCount,
          missingFiles: missingFileCount,
        },
        projects: entries,
        leftOut: {
          data: EXCLUDED_DATA,
          privatePages: await countPrivatePages(row.workspaceId),
          hiddenProjects: hidden.size,
        },
      }),
    );

    const sizeBytes = await writer.finish();
    return {
      filePath,
      sizeBytes,
      fileName: `${entrySegment(slug)}-workspace-${now.toISOString().slice(0, 10)}.zip`,
      contentType: EXPORT_CONTENT_TYPES.zip,
      taskCount: counts.tasks,
      fileCount,
      missingFileCount,
    };
  } catch (error) {
    await writer.abort();
    await rm(filePath, { force: true }).catch(() => undefined);
    if (error instanceof ZipLimitError) {
      throw new ExportFailure(WORKSPACE_EXPORT_TOO_LARGE);
    }
    throw error;
  }
}
