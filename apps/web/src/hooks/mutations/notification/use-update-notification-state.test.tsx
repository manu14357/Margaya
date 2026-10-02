import {
  type InfiniteData,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inboxNotification } from "@/components/inbox/inbox-test-fixtures";
import { inboxQueryKeys } from "@/lib/inbox-cache";
import type { InboxCounts, InboxPage } from "@/types/notification";
import useUpdateNotificationState from "./use-update-notification-state";

const api = vi.hoisted(() => ({
  update: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/fetchers/notification/update-notification-state", () => ({
  default: api.update,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: api.toastSuccess, error: api.toastError },
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => vi.clearAllMocks());

const filters = {
  tab: "all" as const,
  view: "inbox" as const,
  unread: false,
  types: [],
  limit: 50,
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData<InfiniteData<InboxPage>>(
    inboxQueryKeys.inbox("ws", filters),
    {
      pages: [
        {
          items: [inboxNotification(), inboxNotification({ id: "n2" })],
          nextCursor: null,
        },
      ],
      pageParams: [undefined],
    },
  );
  queryClient.setQueryData<InboxCounts>(inboxQueryKeys.counts("ws"), {
    unread: 2,
    unreadMentions: 0,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdateNotificationState(), { wrapper });
  return { queryClient, hook };
}

describe("useUpdateNotificationState", () => {
  it("archives optimistically and offers Undo", async () => {
    let resolve!: (value: unknown) => void;
    api.update.mockReturnValueOnce(
      new Promise((res) => {
        resolve = res;
      }),
    );
    const { queryClient, hook } = setup();

    act(() =>
      hook.result.current.mutate({ id: "n1", change: { action: "archive" } }),
    );

    await waitFor(() => {
      const data = queryClient.getQueryData<InfiniteData<InboxPage>>(
        inboxQueryKeys.inbox("ws", filters),
      );
      expect(data?.pages[0]?.items.map((row) => row.id)).toEqual(["n2"]);
    });
    expect(
      queryClient.getQueryData<InboxCounts>(inboxQueryKeys.counts("ws")),
    ).toEqual({ unread: 1, unreadMentions: 0 });

    api.update.mockResolvedValue({});
    await act(async () => resolve({}));
    await waitFor(() => expect(api.toastSuccess).toHaveBeenCalled());
    const [title, options] = api.toastSuccess.mock.calls[0] ?? [];
    expect(title).toBe("notifications:inbox.toasts.archived");

    await act(async () => options.action.onClick());
    await waitFor(() =>
      expect(api.update).toHaveBeenLastCalledWith("n1", {
        action: "unarchive",
      }),
    );
    // The Undo itself is silent.
    expect(api.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("rolls back and toasts when the change fails", async () => {
    api.update.mockRejectedValue(new Error("nope"));
    const { queryClient, hook } = setup();

    act(() =>
      hook.result.current.mutate({
        id: "n1",
        change: { action: "read" },
        silent: true,
      }),
    );

    await waitFor(() =>
      expect(api.toastError).toHaveBeenCalledWith(
        "notifications:inbox.toasts.error",
      ),
    );
    const data = queryClient.getQueryData<InfiniteData<InboxPage>>(
      inboxQueryKeys.inbox("ws", filters),
    );
    expect(data?.pages[0]?.items[0]?.isRead).toBe(false);
    expect(
      queryClient.getQueryData<InboxCounts>(inboxQueryKeys.counts("ws")),
    ).toEqual({ unread: 2, unreadMentions: 0 });
  });
});
