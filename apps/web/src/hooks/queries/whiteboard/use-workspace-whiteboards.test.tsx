import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateWhiteboardQueries } from "@/hooks/mutations/whiteboard/invalidate-whiteboard-queries";
import { handleWhiteboardHint } from "@/lib/whiteboards/whiteboard-realtime";
import {
  useWorkspaceWhiteboards,
  WORKSPACE_WHITEBOARDS_REFETCH_MS,
} from "./use-workspace-whiteboards";
import { whiteboardQueryKeys } from "./whiteboard-query-keys";

const api = vi.hoisted(() => ({ listWorkspaceWhiteboards: vi.fn() }));

vi.mock("@/fetchers/whiteboard/whiteboards", () => api);

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  api.listWorkspaceWhiteboards.mockReset();
  api.listWorkspaceWhiteboards.mockResolvedValue({ whiteboards: [] });
});

describe("useWorkspaceWhiteboards", () => {
  it("loads the workspace list under its own key with trimmed filters", async () => {
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(
      () => useWorkspaceWhiteboards("w1", { archived: true, q: " map " }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.listWorkspaceWhiteboards).toHaveBeenCalledWith("w1", {
      archived: true,
      q: "map",
    });
    const [query] = queryClient.getQueryCache().getAll();
    expect(query?.queryKey).toEqual([
      "whiteboards",
      "workspace",
      "w1",
      { archived: true, q: "map" },
    ]);
    // No project socket on workspace screens: it polls while visible.
    const options = query?.options as { refetchInterval?: unknown } | undefined;
    expect(options?.refetchInterval).toBe(WORKSPACE_WHITEBOARDS_REFETCH_MS);
  });

  it("waits for a workspace", () => {
    const { wrapper } = setup();
    renderHook(() => useWorkspaceWhiteboards("", { archived: false, q: "" }), {
      wrapper,
    });
    expect(api.listWorkspaceWhiteboards).not.toHaveBeenCalled();
  });
});

describe("workspace list refresh", () => {
  const keysOf = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map(
      (call: unknown[]) => (call[0] as { queryKey: unknown[] }).queryKey,
    );

  it("refreshes with any change to a project's boards", () => {
    const { queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    invalidateWhiteboardQueries(queryClient, { projectId: "p1" });
    expect(keysOf(invalidate)).toContainEqual(
      whiteboardQueryKeys.workspaceLists(),
    );
  });

  it("refreshes on a whiteboard.changed hint", () => {
    const { queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    handleWhiteboardHint(queryClient, {
      type: "whiteboard.changed",
      projectId: "p1",
      whiteboardId: "wb1",
    });
    expect(keysOf(invalidate)).toContainEqual(["whiteboards", "workspace"]);
  });
});
