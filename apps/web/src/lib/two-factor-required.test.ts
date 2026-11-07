import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./http-error";
import {
  isTwoFactorRequired,
  needsTwoFactorSetup,
  returnPathAfterSetup,
} from "./two-factor-required";

const getConfig = vi.fn();
const getAccountSecurity = vi.fn();

vi.mock("@/fetchers/config/get-config", () => ({
  getConfig: () => getConfig(),
}));
vi.mock("@/fetchers/user/get-account-security", () => ({
  default: () => getAccountSecurity(),
}));

beforeEach(() => {
  getConfig.mockReset();
  getAccountSecurity.mockReset();
});

describe("isTwoFactorRequired", () => {
  const body = JSON.stringify({ code: "TWO_FACTOR_REQUIRED", message: "x" });

  it("recognises the API's refusal and nothing else", () => {
    expect(isTwoFactorRequired(new HttpError(403, body))).toBe(true);
    expect(isTwoFactorRequired(new HttpError(500, body))).toBe(false);
    expect(isTwoFactorRequired(new HttpError(403, "Forbidden"))).toBe(false);
    expect(
      isTwoFactorRequired(
        new HttpError(403, JSON.stringify({ code: "REAUTH_REQUIRED" })),
      ),
    ).toBe(false);
    expect(isTwoFactorRequired(new Error(body))).toBe(false);
  });
});

describe("returnPathAfterSetup", () => {
  it("only returns to a path in this app", () => {
    expect(returnPathAfterSetup("/invitation/accept/abc?x=1")).toBe(
      "/invitation/accept/abc?x=1",
    );
    expect(returnPathAfterSetup("//evil.example")).toBe("/dashboard");
    expect(returnPathAfterSetup("https://evil.example")).toBe("/dashboard");
    expect(returnPathAfterSetup(undefined)).toBe("/dashboard");
  });
});

describe("needsTwoFactorSetup", () => {
  const client = () => new QueryClient();

  it("costs nothing more than the settings while it isn't required", async () => {
    getConfig.mockResolvedValue({ requireTwoFactor: false });
    expect(await needsTwoFactorSetup(client())).toBe(false);
    expect(getAccountSecurity).not.toHaveBeenCalled();
  });

  it("asks the API whether this account is covered", async () => {
    getConfig.mockResolvedValue({ requireTwoFactor: true });
    getAccountSecurity.mockResolvedValue({
      twoFactorRequired: true,
      twoFactorEnabled: false,
    });
    expect(await needsTwoFactorSetup(client())).toBe(true);

    getAccountSecurity.mockResolvedValue({
      twoFactorRequired: false,
      twoFactorEnabled: false,
    });
    expect(await needsTwoFactorSetup(client())).toBe(false);

    getAccountSecurity.mockResolvedValue({
      twoFactorRequired: true,
      twoFactorEnabled: true,
    });
    expect(await needsTwoFactorSetup(client())).toBe(false);
  });

  it("re-reads the settings once its copy is a minute old", async () => {
    const queryClient = client();
    getConfig.mockResolvedValue({ requireTwoFactor: false });
    await needsTwoFactorSetup(queryClient);
    await needsTwoFactorSetup(queryClient);
    expect(getConfig).toHaveBeenCalledTimes(1);

    const later = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    getConfig.mockResolvedValue({ requireTwoFactor: true });
    getAccountSecurity.mockResolvedValue({
      twoFactorRequired: true,
      twoFactorEnabled: false,
    });
    expect(await needsTwoFactorSetup(queryClient)).toBe(true);
    later.mockRestore();
  });

  it("leaves the decision to the API when it can't tell", async () => {
    getConfig.mockRejectedValue(new Error("offline"));
    expect(await needsTwoFactorSetup(client())).toBe(false);
  });
});
