import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onPageDeleted } from "./page-events";
import { handlePageHint } from "./page-realtime";

function keysInvalidated(client: QueryClient) {
  const spy = vi.spyOn(client, "invalidateQueries");
  return () => spy.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
}

describe("handlePageHint", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refreshes the list, the page and the entities on PAGE_UPDATED", () => {
    const client = new QueryClient();
    const keys = keysInvalidated(client);
    expect(
      handlePageHint(client, {
        type: "PAGE_UPDATED",
        projectId: "p1",
        pageId: "pg1",
      }),
    ).toBe(true);
    expect(keys()).toEqual(
      expect.arrayContaining([
        '["pages","p1"]',
        '["page","pg1"]',
        '["favorites"]',
        '["recent-visits"]',
      ]),
    );
  });

  it("refreshes every open page on PAGES_UPDATED", () => {
    const client = new QueryClient();
    const keys = keysInvalidated(client);
    handlePageHint(client, { type: "PAGES_UPDATED", projectId: "p1" });
    expect(keys()).toEqual(
      expect.arrayContaining(['["pages","p1"]', '["page"]']),
    );
  });

  it("drops the page and tells an open editor on PAGE_DELETED", () => {
    const client = new QueryClient();
    client.setQueryData(["page", "pg1"], { id: "pg1" });
    const listener = vi.fn();
    const unsubscribe = onPageDeleted(listener);
    handlePageHint(client, {
      type: "PAGE_DELETED",
      projectId: "p1",
      pageId: "pg1",
    });
    unsubscribe();
    expect(client.getQueryData(["page", "pg1"])).toBeUndefined();
    expect(listener).toHaveBeenCalledWith("pg1");
  });

  it.each([
    { type: "PAGES_UPDATED", projectId: "p1" },
    { type: "PAGE_DELETED", projectId: "p1", pageId: "pg1" },
  ])("refreshes the trash lists on $type", (message) => {
    const client = new QueryClient();
    const keys = keysInvalidated(client);
    handlePageHint(client, message);
    expect(keys()).toContain('["trash"]');
  });

  it.each([
    { type: "PAGE_UPDATED", projectId: "p1", pageId: "pg1" },
    { type: "PAGES_UPDATED", projectId: "p1" },
    { type: "PAGE_DELETED", projectId: "p1", pageId: "pg1" },
  ])("refreshes the tasks' page references on $type", (message) => {
    const client = new QueryClient();
    const keys = keysInvalidated(client);
    handlePageHint(client, message);
    expect(keys()).toContain('["page-task-references"]');
  });

  it("ignores other messages", () => {
    expect(handlePageHint(new QueryClient(), { type: "TASK_UPDATED" })).toBe(
      false,
    );
  });
});
