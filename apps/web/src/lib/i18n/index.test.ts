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
const { hasChunkLoadFailed } = await import("@/lib/chunk-load");

const fetchFailure = () =>
  new TypeError("Failed to fetch dynamically imported module: /assets/x.js");

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

describe("loading under load", () => {
  it("tries a translation chunk again when it could not be fetched", async () => {
    vi.useFakeTimers();
    try {
      let failed = false;
      const original = loadPart.getMockImplementation() as
        | ((locale: string, part: string) => Promise<unknown>)
        | undefined;
      loadPart.mockImplementation(async (locale: string, part: string) => {
        if (part !== "whiteboardEditor") return original?.(locale, part);
        if (!failed) {
          failed = true;
          throw fetchFailure();
        }
        return { probe: "loaded" };
      });
      const loading = i18n.loadNamespaces("whiteboardEditor");
      await vi.advanceTimersByTimeAsync(600);
      await loading;
      expect(i18n.getResource("en-US", "whiteboardEditor", "probe")).toBe(
        "loaded",
      );
      expect(hasChunkLoadFailed()).toBe(false);
      if (original) loadPart.mockImplementation(original);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for a reload when a translation chunk never loads", async () => {
    vi.useFakeTimers();
    try {
      loadPart.mockRejectedValue(fetchFailure());
      const loading = i18n.loadNamespaces("instanceAdmin");
      await vi.advanceTimersByTimeAsync(10_000);
      await loading;
      expect(hasChunkLoadFailed()).toBe(true);
    } finally {
      loadPart.mockReset();
      vi.useRealTimers();
    }
  });
});
