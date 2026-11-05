import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLoadFailure } from "./use-load-failure";

afterEach(cleanup);

function setup(queryFn: () => Promise<string>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return {
    client,
    ...renderHook(
      () => {
        const query = useQuery({ queryKey: ["load"], queryFn });
        return { query, failure: useLoadFailure(query) };
      },
      { wrapper },
    ),
  };
}

function deferred() {
  let resolve: (value: string) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useLoadFailure", () => {
  it("reports nothing during the first load or once data arrives", async () => {
    const load = deferred();
    const { result } = setup(() => load.promise);
    expect(result.current.failure).toBeNull();

    load.resolve("ok");
    await waitFor(() => expect(result.current.query.data).toBe("ok"));
    expect(result.current.failure).toBeNull();
  });

  it("keeps the failure and its error through a background refetch", async () => {
    const boom = new Error("boom");
    const queryFn = vi.fn<() => Promise<string>>().mockRejectedValue(boom);
    const { result, client } = setup(queryFn);
    await waitFor(() => expect(result.current.failure?.error).toBe(boom));

    const poll = deferred();
    queryFn.mockReturnValue(poll.promise);
    act(() => {
      void client.refetchQueries({ queryKey: ["load"] });
    });
    await waitFor(() => expect(result.current.query.isLoading).toBe(true));

    expect(result.current.failure?.error).toBe(boom);

    poll.resolve("recovered");
    await waitFor(() => expect(result.current.failure).toBeNull());
  });

  it("shows loading while a person retries, and the failure again if it fails", async () => {
    const boom = new Error("boom");
    const queryFn = vi.fn<() => Promise<string>>().mockRejectedValue(boom);
    const { result } = setup(queryFn);
    await waitFor(() => expect(result.current.failure).not.toBeNull());

    const attempt = deferred();
    queryFn.mockReturnValue(attempt.promise);
    act(() => result.current.failure?.retry());
    await waitFor(() => expect(result.current.query.isLoading).toBe(true));
    expect(result.current.failure).toBeNull();

    await act(async () => {
      attempt.reject(new Error("still down"));
      await attempt.promise.catch(() => {});
    });
    await waitFor(() =>
      expect((result.current.failure?.error as Error)?.message).toBe(
        "still down",
      ),
    );
  });

  it("treats a query paused while offline as failed", () => {
    const { result } = renderHook(() =>
      useLoadFailure({
        data: undefined,
        error: null,
        errorUpdatedAt: 0,
        isLoading: false,
        refetch: async () => undefined,
      }),
    );
    expect(result.current).not.toBeNull();
  });
});
