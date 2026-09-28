import { type InfiniteData, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { taskDraftQueryKeys } from "@/hooks/queries/task-draft/task-draft-query-keys";
import type { TaskDraftList } from "@/types/task-draft";
import {
  removeDraftFromCache,
  restoreDraftCache,
} from "./remove-draft-from-cache";

function page(ids: string[], total: number): TaskDraftList {
  return {
    drafts: ids.map((id) => ({ id }) as TaskDraftList["drafts"][number]),
    total,
    page: 1,
    limit: 50,
    hasMore: false,
  };
}

describe("removeDraftFromCache", () => {
  it("removes the draft from every list and lowers the count, reversibly", () => {
    const queryClient = new QueryClient();
    const all = taskDraftQueryKeys.list("w1", {});
    const filtered = taskDraftQueryKeys.list("w1", { q: "fix" });
    const count = taskDraftQueryKeys.count("w1");
    const allData: InfiniteData<TaskDraftList> = {
      pages: [page(["a", "b"], 2)],
      pageParams: [1],
    };
    queryClient.setQueryData(all, allData);
    queryClient.setQueryData(filtered, {
      pages: [page(["b"], 1)],
      pageParams: [1],
    });
    queryClient.setQueryData(count, { count: 2 });

    const snapshot = removeDraftFromCache(queryClient, "w1", "b");

    const after = queryClient.getQueryData<InfiniteData<TaskDraftList>>(all);
    expect(after?.pages[0]?.drafts.map((draft) => draft.id)).toEqual(["a"]);
    expect(after?.pages[0]?.total).toBe(1);
    expect(
      queryClient.getQueryData<InfiniteData<TaskDraftList>>(filtered)?.pages[0]
        ?.drafts,
    ).toEqual([]);
    expect(queryClient.getQueryData(count)).toEqual({ count: 1 });

    restoreDraftCache(queryClient, snapshot);
    expect(queryClient.getQueryData(all)).toEqual(allData);
    expect(queryClient.getQueryData(count)).toEqual({ count: 2 });
  });

  it("leaves other workspaces alone", () => {
    const queryClient = new QueryClient();
    const other = taskDraftQueryKeys.list("w2", {});
    queryClient.setQueryData(other, {
      pages: [page(["b"], 1)],
      pageParams: [1],
    });
    removeDraftFromCache(queryClient, "w1", "b");
    expect(
      queryClient.getQueryData<InfiniteData<TaskDraftList>>(other)?.pages[0]
        ?.drafts,
    ).toHaveLength(1);
  });
});
