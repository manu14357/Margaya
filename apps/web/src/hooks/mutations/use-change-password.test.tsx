import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useChangePassword from "./use-change-password";
import useRevokeOtherSessions from "./user/use-revoke-other-sessions";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    changePassword: vi.fn(),
    revokeOtherSessions: vi.fn(),
    keep: vi.fn(async (action: () => Promise<unknown>) => action()),
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    changePassword: mocks.changePassword,
    revokeOtherSessions: mocks.revokeOtherSessions,
  },
}));
vi.mock(
  "@/hooks/mutations/notification-preferences/use-push-subscription",
  () => ({ withPushKeptOnThisDevice: mocks.keep }),
);

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
  mocks.changePassword.mockReset().mockResolvedValue({ error: null });
  mocks.revokeOtherSessions.mockReset().mockResolvedValue({ error: null });
  mocks.keep.mockClear();
});

describe("signing out the other sessions keeps push on this device", () => {
  const passwords = { currentPassword: "old", newPassword: "new" };

  it("when a password change signs them out", async () => {
    const { result, invalidate } = hook(useChangePassword);
    await act(async () => {
      await result.current.mutateAsync({
        ...passwords,
        revokeOtherSessions: true,
      });
    });
    expect(mocks.keep).toHaveBeenCalledTimes(1);
    expect(mocks.changePassword).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["push-status"] });
  });

  it("and leaves it alone when a password change signs nobody out", async () => {
    const { result } = hook(useChangePassword);
    await act(async () => {
      await result.current.mutateAsync({
        ...passwords,
        revokeOtherSessions: false,
      });
    });
    expect(mocks.keep).not.toHaveBeenCalled();
    expect(mocks.changePassword).toHaveBeenCalledTimes(1);
  });

  it("when they are signed out from the sessions list", async () => {
    const { result, invalidate } = hook(useRevokeOtherSessions);
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(mocks.keep).toHaveBeenCalledTimes(1);
    expect(mocks.revokeOtherSessions).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["push-status"] });
  });
});
