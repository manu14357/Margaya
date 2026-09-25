import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { moveFavorite } from "@/lib/favorites";
import useReorderFavorites from "./use-reorder-favorites";

const reorderFavorites = vi.hoisted(() => vi.fn());

vi.mock("@/fetchers/favorite/reorder-favorites", () => ({
  default: reorderFavorites,
}));

const favorite = (id: string, position: number) =>
  ({
    id,
    workspaceId: "ws-1",
    projectId: `p-${id}`,
    entityType: "project",
    entityId: `p-${id}`,
    position,
    createdAt: "2026-09-25T00:00:00.000Z",
    entity: {
      type: "project",
      id: `p-${id}`,
      name: id,
      key: null,
      icon: null,
      projectId: `p-${id}`,
      projectName: id,
      isArchived: false,
      feature: null,
      details: null,
    },
  }) as const;

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const initial = [favorite("a", 0), favorite("b", 1), favorite("c", 2)];
  queryClient.setQueryData(["favorites", "ws-1"], initial);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useReorderFavorites(), { wrapper });
  return { queryClient, initial, reorder: result.current };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useReorderFavorites", () => {
  it("writes the new order at once and sends every id", async () => {
    reorderFavorites.mockResolvedValue([]);
    const { queryClient, initial, reorder } = setup();
    const ordered = moveFavorite(initial, "c", "a");

    act(() => reorder("ws-1", ordered));

    expect(
      queryClient
        .getQueryData<{ id: string }[]>(["favorites", "ws-1"])
        ?.map((item) => item.id),
    ).toEqual(["c", "a", "b"]);
    await waitFor(() =>
      expect(reorderFavorites).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        favoriteIds: ["c", "a", "b"],
      }),
    );
  });

  it("rolls back when the server refuses", async () => {
    reorderFavorites.mockRejectedValue(new Error("nope"));
    const { queryClient, initial, reorder } = setup();
    const onError = vi.fn();

    act(() => reorder("ws-1", moveFavorite(initial, "a", "c"), { onError }));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(queryClient.getQueryData(["favorites", "ws-1"])).toEqual(initial);
  });
});
