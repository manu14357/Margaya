import { eq } from "drizzle-orm";
import { expect } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { runNextExport } from "../../../apps/api/src/task-export/runner";
import { draftScene } from "./drafts";

type User = typeof schema.userTable.$inferSelect;
type TaskInsert = typeof schema.taskTable.$inferInsert;

export type ExportJson = {
  id: string;
  workspaceId: string;
  format: "csv" | "json" | "xlsx";
  projectIds: string[];
  projects: { id: string; name: string; slug: string }[];
  splitByProject: boolean;
  includeArchived: boolean;
  status: "queued" | "processing" | "completed" | "failed" | "expired";
  error: string | null;
  taskCount: number | null;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  requestedBy: { id: string; name: string; image: string | null } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  downloadable: boolean;
};

export type ExportPageJson = { items: ExportJson[]; nextCursor: string | null };

/** Runs queued exports on this instance until the queue is empty. */
export async function drainExports(): Promise<string[]> {
  const ids: string[] = [];
  for (;;) {
    const id = await runNextExport();
    if (!id) return ids;
    ids.push(id);
  }
}

export async function exportRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.taskExportTable)
    .where(eq(schema.taskExportTable.id, id));
  return row ?? null;
}

/** Parses CSV text written by the export (every field quoted, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else {
      field += char;
    }
  }
  return rows;
}

/**
 * The draft scene (Owen owner, Ada admin, Mia member, Vic viewer, an
 * outsider; projects "web" and "api") plus task seeding and export calls.
 */
export async function exportScene() {
  const s = await draftScene();
  const numbers = new Map<string, number>();

  const createTask = async (values: Partial<TaskInsert> = {}) => {
    const projectId = values.projectId ?? s.web.project.id;
    const number = values.number ?? (numbers.get(projectId) ?? 0) + 1;
    numbers.set(projectId, Math.max(number, numbers.get(projectId) ?? 0));
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title: `Task ${number}`,
        number,
        status: "to-do",
        priority: "medium",
        ...values,
      })
      .returning();
    if (!task) throw new Error("Failed to create task");
    return task;
  };

  const startExport = (user: User, body: Record<string, unknown>) =>
    s.ok<ExportJson>(user, "POST", "/task-export", {
      workspaceId: s.workspaceId,
      ...body,
    });

  /** Starts an export as `user`, runs it, and returns the finished row. */
  const runExport = async (user: User, body: Record<string, unknown>) => {
    const started = await startExport(user, body);
    await drainExports();
    const row = await exportRow(started.id);
    if (!row) throw new Error("The export row is gone");
    return row;
  };

  const download = async (user: User, id: string): Promise<Buffer> => {
    const response = await s.as(user)("GET", `/task-export/${id}/download`);
    expect(response.status, await response.clone().text()).toBe(200);
    return Buffer.from(await response.arrayBuffer());
  };

  return { ...s, createTask, startExport, runExport, download };
}
