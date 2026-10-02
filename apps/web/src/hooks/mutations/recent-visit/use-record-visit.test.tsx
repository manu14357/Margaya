import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RECORD_VISIT_THROTTLE_MS,
  resetRecordedVisits,
  useRecordVisit,
  visitArchiveState,
} from "./use-record-visit";

const recordRecentVisit = vi.hoisted(() => vi.fn());

vi.mock("@/fetchers/recent-visit/record-recent-visit", () => ({
  default: recordRecentVisit,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-25T10:00:00Z"));
  recordRecentVisit.mockResolvedValue({});
  resetRecordedVisits();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const props = {
  workspaceId: "ws-1",
  entityType: "project" as const,
  entityId: "project-1",
};

describe("useRecordVisit", () => {
  it("records a visit on mount", () => {
    renderHook(() => useRecordVisit(props));
    expect(recordRecentVisit).toHaveBeenCalledWith(props);
  });

  it("does not post again for a second mount within a minute", () => {
    renderHook(() => useRecordVisit(props)).unmount();
    renderHook(() => useRecordVisit(props));
    expect(recordRecentVisit).toHaveBeenCalledTimes(1);
  });

  it("posts again once the minute has passed", () => {
    renderHook(() => useRecordVisit(props)).unmount();
    vi.setSystemTime(Date.now() + RECORD_VISIT_THROTTLE_MS + 1);
    renderHook(() => useRecordVisit(props));
    expect(recordRecentVisit).toHaveBeenCalledTimes(2);
  });

  it("records each entity separately and skips missing ids", () => {
    renderHook(() => useRecordVisit(props));
    renderHook(() => useRecordVisit({ ...props, entityId: "project-2" }));
    renderHook(() => useRecordVisit({ ...props, entityId: undefined }));
    expect(recordRecentVisit).toHaveBeenCalledTimes(2);
  });

  it("swallows failures", async () => {
    recordRecentVisit.mockRejectedValueOnce(new Error("409"));
    expect(() => renderHook(() => useRecordVisit(props))).not.toThrow();
    await Promise.resolve();
  });

  it("never posts an archived entity, which the API refuses", () => {
    renderHook(() => useRecordVisit({ ...props, archived: true }));
    expect(recordRecentVisit).not.toHaveBeenCalled();
  });

  it("waits while the archive state is unknown, then records once", () => {
    const view = renderHook(
      ({ archived }: { archived: boolean | null }) =>
        useRecordVisit({ ...props, archived }),
      { initialProps: { archived: null as boolean | null } },
    );
    expect(recordRecentVisit).not.toHaveBeenCalled();
    view.rerender({ archived: false });
    expect(recordRecentVisit).toHaveBeenCalledTimes(1);
  });

  it("records a restored entity once it is no longer archived", () => {
    const view = renderHook(
      ({ archived }: { archived: boolean }) =>
        useRecordVisit({ ...props, archived }),
      { initialProps: { archived: true } },
    );
    view.rerender({ archived: false });
    expect(recordRecentVisit).toHaveBeenCalledTimes(1);
  });
});

describe("visitArchiveState", () => {
  it("is unknown until every entity has loaded", () => {
    expect(visitArchiveState(undefined)).toBeNull();
    expect(visitArchiveState({ archivedAt: null }, undefined)).toBeNull();
  });

  it("is archived when the item or its project is", () => {
    expect(visitArchiveState({ archivedAt: null }, { archivedAt: null })).toBe(
      false,
    );
    expect(
      visitArchiveState(
        { archivedAt: null },
        { archivedAt: "2026-09-01T00:00:00.000Z" },
      ),
    ).toBe(true);
    expect(visitArchiveState({ archivedAt: "2026-09-01T00:00:00.000Z" })).toBe(
      true,
    );
  });
});
