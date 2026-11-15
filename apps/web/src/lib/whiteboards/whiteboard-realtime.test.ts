import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { handleWhiteboardHint } from "./whiteboard-realtime";

function keysOf(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map(
    (call) => (call[0] as { queryKey: unknown[] }).queryKey,
  );
}

describe("handleWhiteboardHint", () => {
  it("refreshes the project's lists, the board, the trash and task lists", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    expect(
      handleWhiteboardHint(queryClient, {
        type: "whiteboard.changed",
        projectId: "p1",
        whiteboardId: "wb1",
      }),
    ).toBe(true);
    expect(keysOf(spy)).toEqual([
      ["whiteboards", "p1"],
      ["whiteboards", "workspace"],
      ["whiteboard", "wb1"],
      ["whiteboard-content", "wb1"],
      ["whiteboard-activity", "wb1"],
      ["trash"],
      ["task-whiteboards"],
    ]);
  });

  it("ignores ids that aren't strings", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    handleWhiteboardHint(queryClient, {
      type: "whiteboard.changed",
      projectId: 7,
      whiteboardId: { id: "x" },
    });
    expect(keysOf(spy)).toEqual([["trash"], ["task-whiteboards"]]);
  });

  it("leaves other messages alone", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    expect(
      handleWhiteboardHint(queryClient, {
        type: "PAGE_UPDATED",
        projectId: "p1",
      }),
    ).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
