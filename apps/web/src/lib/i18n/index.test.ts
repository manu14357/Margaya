import { describe, expect, it, vi } from "vitest";

vi.mock("virtual:margaya-i18n", () => ({
  loadLocalePart: vi.fn(async (_locale: string, part: string) => {
    if (part === "core") {
      return {
        common: { testCommon: "common-value" },
        auth: { testAuth: "auth-value" },
      };
    }
    if (part === "landing") return { testLanding: "landing-value" };
    return undefined;
  }),
}));

const { i18n, preloadNamespaces } = await import("./index");
const { loadLocalePart } = await import("virtual:margaya-i18n");
const loadPart = loadLocalePart as ReturnType<typeof vi.fn>;

describe("preloadNamespaces", () => {
  it("loads every core namespace so non-default keys resolve after async init", async () => {
    await preloadNamespaces("en-US");

    expect(i18n.t("auth:testAuth")).toBe("auth-value");
    expect(i18n.t("common:testCommon")).toBe("common-value");
  });

  it("reuses the cached core part across calls", async () => {
    const coreCalls = () =>
      loadPart.mock.calls.filter(([, part]) => part === "core").length;
    const before = coreCalls();

    await preloadNamespaces("en-US");

    expect(coreCalls()).toBe(before);
  });

  it("leaves lazy namespaces out until something asks for them", async () => {
    await preloadNamespaces("en-US");
    expect(loadPart.mock.calls.some(([, part]) => part === "landing")).toBe(
      false,
    );
    expect(i18n.hasLoadedNamespace("landing")).toBe(false);

    await i18n.loadNamespaces("landing");

    expect(loadPart).toHaveBeenCalledWith("en-US", "landing");
    expect(i18n.t("landing:testLanding")).toBe("landing-value");
  });
});
