import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePurgeWhiteboard } from "@/hooks/mutations/trash/use-whiteboard-trash-mutations";
import {
  useCreateWhiteboard,
  useDeleteWhiteboard,
  useSetWhiteboardArchived,
  useSetWhiteboardPublished,
  useUpdateWhiteboard,
} from "./use-whiteboard-mutations";

const api = vi.hoisted(() => ({
  createWhiteboard: vi.fn(),
  updateWhiteboard: vi.fn(),
  duplicateWhiteboard: vi.fn(),
  deleteWhiteboard: vi.fn(),
  lockWhiteboard: vi.fn(),
  unlockWhiteboard: vi.fn(),
  archiveWhiteboard: vi.fn(),
  unarchiveWhiteboard: vi.fn(),
  publishWhiteboard: vi.fn(),
  unpublishWhiteboard: vi.fn(),
  purgeWhiteboard: vi.fn(),
  restoreDeletedWhiteboard: vi.fn(),
}));

vi.mock("@/fetchers/whiteboard/whiteboards", () => api);
vi.mock("@/fetchers/trash/whiteboard-trash", () => ({
  purgeWhiteboard: api.purgeWhiteboard,
  restoreDeletedWhiteboard: api.restoreDeletedWhiteboard,
}));

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const keys = () =>
    invalidate.mock.calls.map(
      (call) => (call[0] as { queryKey: unknown[] }).queryKey,
    );
  return { queryClient, wrapper, keys };
}

const board = {
  id: "wb1",
  projectId: "p1",
  title: "Plan",
  icon: null,
  publicToken: null,
  publishedAt: null,
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe("whiteboard mutations", () => {
  it("caches a new board and refreshes the project's lists", async () => {
    api.createWhiteboard.mockResolvedValue(board);
    const { wrapper, keys, queryClient } = setup();
    const { result } = renderHook(() => useCreateWhiteboard(), { wrapper });
    await act(() => result.current.mutateAsync({ projectId: "p1" }));
    expect(queryClient.getQueryData(["whiteboard", "wb1"])).toEqual(board);
    expect(keys()).toEqual([
      ["whiteboards", "p1"],
      ["whiteboards", "workspace"],
    ]);
  });

  it("renames at once, and rolls back when the API refuses", async () => {
    let refuse!: (error: Error) => void;
    api.updateWhiteboard.mockReturnValue(
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
    );
    const { wrapper, queryClient } = setup();
    queryClient.setQueryData(["whiteboard", "wb1"], board);
    const { result } = renderHook(() => useUpdateWhiteboard(), { wrapper });
    const pending = result.current
      .mutateAsync({ whiteboardId: "wb1", projectId: "p1", title: "Renamed" })
      .catch(() => undefined);
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryData<typeof board>(["whiteboard", "wb1"])?.title,
      ).toBe("Renamed"),
    );
    await act(async () => {
      refuse(new Error("locked"));
      await pending;
    });
    expect(
      queryClient.getQueryData<typeof board>(["whiteboard", "wb1"])?.title,
    ).toBe("Plan");
    expect(api.updateWhiteboard).toHaveBeenCalledWith("wb1", {
      title: "Renamed",
    });
  });

  it("refreshes lists, the board and task lists after archiving", async () => {
    api.archiveWhiteboard.mockResolvedValue(board);
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useSetWhiteboardArchived(), {
      wrapper,
    });
    await act(() =>
      result.current.mutateAsync({
        whiteboardId: "wb1",
        projectId: "p1",
        archived: true,
      }),
    );
    expect(api.archiveWhiteboard).toHaveBeenCalledWith("wb1");
    expect(keys()).toEqual([
      ["whiteboards", "p1"],
      ["whiteboards", "workspace"],
      ["whiteboard", "wb1"],
      ["whiteboard-content", "wb1"],
      ["whiteboard-activity", "wb1"],
      ["task-whiteboards"],
    ]);
  });

  it("drops a trashed board and refreshes the trash", async () => {
    api.deleteWhiteboard.mockResolvedValue({ id: "wb1", projectId: "p1" });
    const { wrapper, keys, queryClient } = setup();
    queryClient.setQueryData(["whiteboard", "wb1"], board);
    const { result } = renderHook(() => useDeleteWhiteboard(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ whiteboardId: "wb1", projectId: "p1" }),
    );
    expect(queryClient.getQueryData(["whiteboard", "wb1"])).toBeUndefined();
    expect(keys()).toEqual([
      ["whiteboards", "p1"],
      ["whiteboards", "workspace"],
      ["trash"],
      ["task-whiteboards"],
    ]);
  });

  it("writes the new public token into the board", async () => {
    api.publishWhiteboard.mockResolvedValue({
      publicToken: "tok",
      publishedAt: "2026-11-14T10:00:00Z",
    });
    const { wrapper, queryClient } = setup();
    queryClient.setQueryData(["whiteboard", "wb1"], board);
    const { result } = renderHook(() => useSetWhiteboardPublished(), {
      wrapper,
    });
    await act(() =>
      result.current.mutateAsync({
        whiteboardId: "wb1",
        projectId: "p1",
        published: true,
      }),
    );
    expect(
      queryClient.getQueryData<typeof board>(["whiteboard", "wb1"])
        ?.publicToken,
    ).toBe("tok");
  });

  it("refreshes the trash, lists and task lists after a purge", async () => {
    api.purgeWhiteboard.mockResolvedValue({ id: "wb1", projectId: "p1" });
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => usePurgeWhiteboard("p1"), {
      wrapper,
    });
    await act(() => result.current.mutateAsync("wb1"));
    expect(keys()).toEqual([
      ["whiteboards", "p1"],
      ["whiteboards", "workspace"],
      ["trash"],
      ["task-whiteboards"],
    ]);
  });
});
