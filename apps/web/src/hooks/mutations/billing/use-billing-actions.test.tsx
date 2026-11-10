import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  checkout: vi.fn(async () => ({ checkoutUrl: "https://pay.example.com/c/1" })),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/billing/create-checkout", () => ({
  createBillingCheckout: mocks.checkout,
  createBillingPortal: vi.fn(async () => ({
    portalUrl: "https://pay.example.com/portal",
  })),
}));
vi.mock("@/lib/toast", () => ({ toast: { info: mocks.info } }));

import { useCreateCheckout } from "./use-billing-actions";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "__MARGAYA_DESKTOP__");
  vi.clearAllMocks();
});

describe("billing in the desktop app", () => {
  it("continues checkout in the browser and refreshes the plan on return", async () => {
    const openExternal = vi.fn();
    Object.defineProperty(window, "__MARGAYA_DESKTOP__", {
      configurable: true,
      value: { openExternal },
    });
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const before = window.location.href;
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useCreateCheckout("w1"), { wrapper });

    act(() => result.current.mutate({ plan: "team", interval: "monthly" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(openExternal).toHaveBeenCalledWith("https://pay.example.com/c/1");
    expect(window.location.href).toBe(before);
    expect(mocks.info).toHaveBeenCalledWith(
      "settings:continueInBrowser.title",
      { description: "settings:continueInBrowser.billing" },
    );
    expect(invalidate).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("focus"));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["billing", "w1"] });
  });
});
