import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import queryClient from "./index";

vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));

/** Runs a mutation through the shared client's mutation cache. */
async function run(options: {
  variables?: unknown;
  meta?: Record<string, unknown>;
  fail?: boolean;
}) {
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationFn: async () => {
      if (options.fail) throw new Error("failed");
      return {};
    },
    meta: options.meta,
  });
  await mutation.execute(options.variables ?? {}).catch(() => {});
}

const taskQueryKey = ["task-query", "w1", "p1", "rows", {}];

describe("task query refresh after mutations", () => {
  let invalidate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    invalidate = vi.spyOn(queryClient, "invalidateQueries");
  });

  afterEach(() => {
    invalidate.mockRestore();
    vi.useRealTimers();
  });

  it("leaves task lists alone after mutations that cannot change tasks", async () => {
    await run({ variables: { commentId: "c1", body: "Hi" } });
    await vi.advanceTimersByTimeAsync(200);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("refreshes them once after a burst of opted-in mutations", async () => {
    await run({ meta: { refreshTaskQueries: true } });
    await run({ meta: { refreshTaskQueries: true }, fail: true });
    await vi.advanceTimersByTimeAsync(200);
    // One refresh: the task query results plus My work.
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("refreshes after an edit that patched a cached row, opted in or not", async () => {
    queryClient.setQueryData(taskQueryKey, {
      tasks: { t1: { id: "t1", title: "Old" } },
    });
    await run({ variables: { id: "t1", title: "New" }, fail: true });
    expect(
      queryClient.getQueryData<{ tasks: Record<string, { title: string }> }>(
        taskQueryKey,
      )?.tasks.t1?.title,
    ).toBe("New");
    await vi.advanceTimersByTimeAsync(200);
    expect(invalidate).toHaveBeenCalled();
  });

  it("does not refresh for an edit-shaped mutation of something else", async () => {
    await run({ variables: { id: "page-1", title: "A page" } });
    await vi.advanceTimersByTimeAsync(200);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
