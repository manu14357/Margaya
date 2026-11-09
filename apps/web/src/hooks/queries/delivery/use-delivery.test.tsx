import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliveryQueryKeys } from "./delivery-query-keys";
import { useForecast, useHomeRisks, useRisks } from "./use-delivery";

const m = vi.hoisted(() => ({
  forecast: vi.fn(),
  risks: vi.fn(),
  home: vi.fn(),
}));
vi.mock("@/fetchers/delivery/get-forecast", () => ({ default: m.forecast }));
vi.mock("@/fetchers/delivery/get-risks", () => ({ default: m.risks }));
vi.mock("@/fetchers/delivery/get-home-risks", () => ({ default: m.home }));

let queryClient: QueryClient;

// The cases mix forecast, risks and home risks; they share this much.
function mount(hook: () => { isSuccess: boolean }) {
  return renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

const scope = { projectId: "p1", scope: "cycle" as const, id: "c1" };

beforeEach(() => {
  // The app's client never refetches on mount by default. Nothing is
  // collected, so a remount always finds the earlier result.
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnMount: false,
        retry: false,
        gcTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  for (const fetcher of Object.values(m)) {
    fetcher.mockReset().mockResolvedValue({});
  }
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("delivery queries", () => {
  it.each([
    ["forecast", () => useForecast(scope), m.forecast],
    ["risks", () => useRisks(scope), m.risks],
  ])(
    "load the %s again when a change marked them stale while off screen",
    async (_name, hook, fetcher) => {
      const first = mount(hook);
      await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
      first.unmount();

      // A task moved on the board while the cycle page was closed.
      await queryClient.invalidateQueries({
        queryKey: deliveryQueryKeys.all("p1"),
      });
      expect(fetcher).toHaveBeenCalledTimes(1);

      const again = mount(hook);
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      again.unmount();
    },
  );

  it.each([
    ["forecast", () => useForecast(scope), m.forecast],
    ["risks", () => useRisks(scope), m.risks],
    ["home risks", () => useHomeRisks("w1"), m.home],
  ])(
    "keep a fresh %s on remount when nothing changed",
    async (_name, hook, fetcher) => {
      const first = mount(hook);
      await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
      first.unmount();

      const again = mount(hook);
      expect(again.result.current.isSuccess).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetcher).toHaveBeenCalledTimes(1);
      again.unmount();
    },
  );

  it("loads home risks again once they are older than their freshness", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const first = mount(() => useHomeRisks("w1"));
      await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
      first.unmount();

      vi.advanceTimersByTime(5 * 60_000 + 1);
      const again = mount(() => useHomeRisks("w1"));
      await waitFor(() => expect(m.home).toHaveBeenCalledTimes(2));
      again.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
