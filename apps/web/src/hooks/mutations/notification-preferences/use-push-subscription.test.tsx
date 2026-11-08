import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  releasePushOnSignOut,
  useRemovePushDevice,
  useTurnOffPush,
  useTurnOnPush,
  withPushKeptOnThisDevice,
} from "./use-push-subscription";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    subscription: null as null | {
      endpoint: string;
      unsubscribe: ReturnType<typeof vi.fn>;
    },
    subscribe: vi.fn(),
    getStatus: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("i18next", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/lib/push", () => ({
  getBrowserSubscription: async () => mocks.subscription,
  subscribeBrowser: mocks.subscribe,
}));
vi.mock("@/fetchers/notification-preferences/get-push-status", () => ({
  default: mocks.getStatus,
}));
vi.mock("@/fetchers/notification-preferences/save-push-subscription", () => ({
  default: mocks.save,
}));
vi.mock("@/fetchers/notification-preferences/delete-push-subscription", () => ({
  default: mocks.remove,
}));

const ENDPOINT = "https://push.example.com/1";
const keys = { p256dh: "p", auth: "a" };

function hook<T>(useHook: () => T) {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(useHook, { wrapper }), invalidate };
}

afterEach(cleanup);

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    if (typeof fn === "function") fn.mockReset();
  }
  mocks.subscription = {
    endpoint: ENDPOINT,
    unsubscribe: vi.fn(async () => true),
  };
  mocks.getStatus.mockResolvedValue({
    subscriptions: [{ id: "d1", endpoint: ENDPOINT }],
  });
});

describe("useTurnOnPush", () => {
  it("subscribes the browser and saves it on the server", async () => {
    mocks.subscribe.mockResolvedValue({
      toJSON: () => ({ endpoint: ENDPOINT, keys, expirationTime: null }),
    });
    const { result, invalidate } = hook(useTurnOnPush);

    await act(async () => {
      result.current.mutate("public-key");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.subscribe).toHaveBeenCalledWith("public-key");
    expect(mocks.save).toHaveBeenCalledWith({ endpoint: ENDPOINT, keys });
    expect(mocks.success).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["push-status"] });
  });

  it("treats a refused permission as an answer, not an error", async () => {
    mocks.subscribe.mockRejectedValue(
      new DOMException("denied", "NotAllowedError"),
    );
    const { result, invalidate } = hook(useTurnOnPush);

    await act(async () => {
      result.current.mutate("public-key");
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });

  it("reports any other failure", async () => {
    mocks.subscribe.mockRejectedValue(new Error("no push service"));
    const { result } = hook(useTurnOnPush);

    await act(async () => {
      result.current.mutate("public-key");
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mocks.error).toHaveBeenCalled();
  });
});

describe("withPushKeptOnThisDevice", () => {
  const onBrowser = () => {
    if (!mocks.subscription) throw new Error("no subscription");
    Object.assign(mocks.subscription, {
      toJSON: () => ({ endpoint: ENDPOINT, keys, expirationTime: null }),
    });
  };

  it("puts this browser back once the other sessions have ended", async () => {
    onBrowser();
    const order: string[] = [];
    mocks.getStatus.mockImplementation(async () => {
      order.push("read");
      return { subscriptions: [{ id: "d1", endpoint: ENDPOINT }] };
    });
    mocks.save.mockImplementation(async () => {
      order.push("save");
    });

    const result = await withPushKeptOnThisDevice(async () => {
      order.push("end sessions");
      return "done";
    });

    expect(result).toBe("done");
    expect(order).toEqual(["read", "end sessions", "save"]);
    expect(mocks.save).toHaveBeenCalledWith({ endpoint: ENDPOINT, keys });
    expect(mocks.subscription?.unsubscribe).not.toHaveBeenCalled();
  });

  it("doesn't turn on a browser whose push is off", async () => {
    onBrowser();
    // Removed from another device: the browser still has its subscription.
    mocks.getStatus.mockResolvedValue({ subscriptions: [] });
    await withPushKeptOnThisDevice(async () => "done");
    expect(mocks.save).not.toHaveBeenCalled();

    mocks.subscription = null;
    await withPushKeptOnThisDevice(async () => "done");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves nothing when the action fails, and passes on the failure", async () => {
    onBrowser();
    await expect(
      withPushKeptOnThisDevice(async () => {
        throw new Error("wrong password");
      }),
    ).rejects.toThrow("wrong password");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("never lets push get in the way of the action", async () => {
    onBrowser();
    mocks.getStatus.mockRejectedValueOnce(new Error("offline"));
    await expect(withPushKeptOnThisDevice(async () => "done")).resolves.toBe(
      "done",
    );

    mocks.getStatus.mockResolvedValue({
      subscriptions: [{ id: "d1", endpoint: ENDPOINT }],
    });
    mocks.save.mockRejectedValueOnce(new Error("offline"));
    await expect(withPushKeptOnThisDevice(async () => "done")).resolves.toBe(
      "done",
    );
  });
});

describe("useTurnOffPush", () => {
  it("removes the server's row, then the browser's subscription", async () => {
    const { result } = hook(useTurnOffPush);

    await act(async () => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.remove).toHaveBeenCalledWith("d1");
    expect(mocks.subscription?.unsubscribe).toHaveBeenCalled();
  });

  it("stays on when the server call fails, so the switch tells the truth", async () => {
    mocks.remove.mockRejectedValue(new Error("offline"));
    const { result } = hook(useTurnOffPush);

    await act(async () => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mocks.subscription?.unsubscribe).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });
});

describe("useRemovePushDevice", () => {
  it("removes another device without touching this browser", async () => {
    const { result, invalidate } = hook(useRemovePushDevice);

    await act(async () => {
      result.current.mutate("d2");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.remove).toHaveBeenCalledWith("d2", expect.anything());
    expect(mocks.subscription?.unsubscribe).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["push-status"] });
  });
});

describe("releasePushOnSignOut", () => {
  it("forgets this device everywhere", async () => {
    await releasePushOnSignOut();
    expect(mocks.remove).toHaveBeenCalledWith("d1");
    expect(mocks.subscription?.unsubscribe).toHaveBeenCalled();
  });

  it("silences the browser before asking the server, so a closed tab can't keep it on", async () => {
    // The tab closes while the server call is on the wire: it never answers.
    mocks.getStatus.mockReturnValue(new Promise(() => {}));
    void releasePushOnSignOut();
    await vi.waitFor(() => expect(mocks.getStatus).toHaveBeenCalled());
    expect(mocks.subscription?.unsubscribe).toHaveBeenCalled();
  });

  it("still tells the server when the browser refuses to unsubscribe", async () => {
    mocks.subscription = {
      endpoint: ENDPOINT,
      unsubscribe: vi.fn(async () => {
        throw new Error("browser said no");
      }),
    };
    await releasePushOnSignOut();
    expect(mocks.remove).toHaveBeenCalledWith("d1");
  });

  it("still silences the browser when the server call fails", async () => {
    mocks.getStatus.mockRejectedValue(new Error("offline"));
    await expect(releasePushOnSignOut()).resolves.toBeUndefined();
    expect(mocks.subscription?.unsubscribe).toHaveBeenCalled();
  });

  it("does nothing, and asks nothing, without a subscription", async () => {
    mocks.subscription = null;
    await releasePushOnSignOut();
    expect(mocks.getStatus).not.toHaveBeenCalled();
  });

  it("never stops a sign-out", async () => {
    mocks.subscription = {
      endpoint: ENDPOINT,
      unsubscribe: vi.fn(async () => {
        throw new Error("browser said no");
      }),
    };
    await expect(releasePushOnSignOut()).resolves.toBeUndefined();
  });
});
