import { beforeEach, describe, expect, it, vi } from "vitest";

// The store reads localStorage when the module loads, so each case imports a
// fresh copy after arranging storage.
async function loadStore() {
  vi.resetModules();
  const { useUserPreferencesStore } = await import("./user-preferences");
  return useUserPreferencesStore;
}

describe("user preferences theme", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to the light theme for a new visitor", async () => {
    const store = await loadStore();
    expect(store.getState().theme).toBe("light");
  });

  it("keeps a theme the user already saved", async () => {
    for (const theme of ["dark", "system"] as const) {
      localStorage.setItem(
        "user-preferences",
        JSON.stringify({ state: { theme }, version: 0 }),
      );
      const store = await loadStore();
      expect(store.getState().theme).toBe(theme);
    }
  });
});
