import importTasks, { type TaskToImport } from "@/fetchers/task/import-tasks";

export const CSV_IMPORT_BATCH_SIZE = 200;
export const JSON_IMPORT_BATCH_SIZE = 500;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new RangeError("Batch size must be at least 1");
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/** One problem with one task, by its index in the imported list. */
export type ImportIssue = {
  index: number;
  kind: "error" | "warning";
  message: string;
};

export type BatchImportResult = {
  total: number;
  successful: number;
  /** Tasks the server rejected plus tasks never sent after a failed batch. */
  failed: number;
  notSent: number;
  issues: ImportIssue[];
  /** Why the import stopped early, or null when every batch was sent. */
  error: string | null;
};

type BatchResponse = { results: { tasks: readonly unknown[] } };
export type SendImportBatch = (tasks: TaskToImport[]) => Promise<BatchResponse>;

// The route documents each outcome only as "carrying a success flag".
function readOutcome(item: unknown): {
  success: boolean;
  error?: string;
  warnings: string[];
} {
  if (!item || typeof item !== "object") {
    return { success: false, warnings: [] };
  }
  const outcome = item as Record<string, unknown>;
  return {
    success: outcome.success === true,
    error: typeof outcome.error === "string" ? outcome.error : undefined,
    warnings: Array.isArray(outcome.warnings)
      ? outcome.warnings.filter(
          (warning): warning is string => typeof warning === "string",
        )
      : [],
  };
}

/**
 * Sends the tasks in sequential batches and merges the per-task outcomes.
 * Stops at the first batch that fails as a whole; what was already imported
 * stays imported.
 */
export async function runImportBatches(
  tasks: readonly TaskToImport[],
  size: number,
  send: SendImportBatch,
  onProgress?: (done: number, total: number) => void,
): Promise<BatchImportResult> {
  const result: BatchImportResult = {
    total: tasks.length,
    successful: 0,
    failed: 0,
    notSent: 0,
    issues: [],
    error: null,
  };
  let offset = 0;

  for (const batch of chunk(tasks, size)) {
    let response: BatchResponse;
    try {
      response = await send(batch);
    } catch (error) {
      result.notSent = tasks.length - offset;
      result.failed += result.notSent;
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }

    batch.forEach((_, position) => {
      const index = offset + position;
      const outcome = readOutcome(response.results.tasks[position]);
      if (outcome.success) {
        result.successful += 1;
      } else {
        result.failed += 1;
        if (outcome.error) {
          result.issues.push({ index, kind: "error", message: outcome.error });
        }
      }
      for (const message of outcome.warnings) {
        result.issues.push({ index, kind: "warning", message });
      }
    });

    offset += batch.length;
    onProgress?.(offset, tasks.length);
  }

  return result;
}

/** Imports into a project in batches through the import route. */
export function importTasksInBatches(
  projectId: string,
  tasks: readonly TaskToImport[],
  size: number,
  onProgress?: (done: number, total: number) => void,
) {
  return runImportBatches(
    tasks,
    size,
    (batch) => importTasks(projectId, batch),
    onProgress,
  );
}
