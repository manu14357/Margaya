import { describe, expect, it, vi } from "vitest";
import type { TaskToImport } from "@/fetchers/task/import-tasks";
import { chunk, runImportBatches, type SendImportBatch } from "./batch";

vi.mock("@/fetchers/task/import-tasks", () => ({ default: vi.fn() }));

function tasks(count: number): TaskToImport[] {
  return Array.from({ length: count }, (_, index) => ({
    title: `T${index}`,
    status: "planned",
  }));
}

const accepted: SendImportBatch = async (batch) => ({
  results: { tasks: batch.map(() => ({ success: true })) },
});

describe("chunk", () => {
  it("splits into batches of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 200)).toEqual([]);
  });

  it("rejects a size below 1", () => {
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
});

describe("runImportBatches", () => {
  it("sends sequential batches and reports progress", async () => {
    const send = vi.fn(accepted);
    const onProgress = vi.fn();

    const result = await runImportBatches(tasks(450), 200, send, onProgress);

    expect(send.mock.calls.map(([batch]) => batch.length)).toEqual([
      200, 200, 50,
    ]);
    expect(onProgress.mock.calls).toEqual([
      [200, 450],
      [400, 450],
      [450, 450],
    ]);
    expect(result).toMatchObject({
      total: 450,
      successful: 450,
      failed: 0,
      notSent: 0,
      issues: [],
      error: null,
    });
  });

  it("merges per-task errors and warnings with global indexes", async () => {
    const send: SendImportBatch = async (batch) => ({
      results: {
        tasks: batch.map((task) =>
          task.title === "T1"
            ? { success: false, error: "Not a member" }
            : task.title === "T2"
              ? { success: true, warnings: ["Cycle skipped: archived"] }
              : { success: true },
        ),
      },
    });

    const result = await runImportBatches(tasks(3), 2, send);

    expect(result.successful).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.issues).toEqual([
      { index: 1, kind: "error", message: "Not a member" },
      { index: 2, kind: "warning", message: "Cycle skipped: archived" },
    ]);
  });

  it("stops at the first failed batch and counts the rest as not sent", async () => {
    const send = vi
      .fn<SendImportBatch>()
      .mockImplementationOnce(accepted)
      .mockRejectedValueOnce(new Error("Import at most 5,000 tasks"));

    const result = await runImportBatches(tasks(5), 2, send);

    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      successful: 2,
      failed: 3,
      notSent: 3,
      error: "Import at most 5,000 tasks",
    });
  });
});
