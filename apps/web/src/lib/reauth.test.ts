import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./http-error";
import { isReauthRequired, useReauthStore, withReauth } from "./reauth";

vi.mock("./i18n", () => ({ i18n: { t: (key: string) => key } }));

const stale = () =>
  new HttpError(
    403,
    JSON.stringify({ code: "REAUTH_REQUIRED", message: "Confirm it's you" }),
  );

afterEach(() => useReauthStore.setState({ open: false, resolve: null }));

describe("withReauth", () => {
  it("recognizes only the server's re-authentication answer", () => {
    expect(isReauthRequired(stale())).toBe(true);
    expect(isReauthRequired(new HttpError(403, "Only instance admins"))).toBe(
      false,
    );
    expect(isReauthRequired(new Error("REAUTH_REQUIRED"))).toBe(false);
  });

  it("asks once, then retries the change after the password is confirmed", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(stale())
      .mockResolvedValueOnce("saved");
    const pending = withReauth(run);
    await vi.waitFor(() => expect(useReauthStore.getState().open).toBe(true));
    useReauthStore.getState().settle(true);
    await expect(pending).resolves.toBe("saved");
    expect(run).toHaveBeenCalledTimes(2);
    expect(useReauthStore.getState().open).toBe(false);
  });

  it("gives up without retrying when the dialog is cancelled", async () => {
    const run = vi.fn().mockRejectedValue(stale());
    const pending = withReauth(run);
    await vi.waitFor(() => expect(useReauthStore.getState().open).toBe(true));
    useReauthStore.getState().settle(false);
    await expect(pending).rejects.toThrow("accountSecurity:reauth.cancelled");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("passes other errors straight through", async () => {
    const run = vi.fn().mockRejectedValue(new HttpError(409, "Locked"));
    await expect(withReauth(run)).rejects.toThrow("Locked");
    expect(useReauthStore.getState().open).toBe(false);
  });
});
