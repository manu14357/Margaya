import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEMES, type Theme } from "@/store/user-preferences";
import { themeClasses } from "./index";

// public/theme-init.js runs before the app to avoid a flash of the wrong
// theme. These cases keep it reading the store's persisted theme and setting
// exactly the classes the provider sets.
const script = readFileSync(
  join(import.meta.dirname, "../../../../public/theme-init.js"),
  "utf8",
);

function runScript() {
  new Function(script)();
}

function prefersDark(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

// Saves the theme the way the app does: through the persisted store.
async function saveTheme(theme: Theme) {
  vi.resetModules();
  const { useUserPreferencesStore } = await import("@/store/user-preferences");
  useUserPreferencesStore.getState().setTheme(theme);
}

function htmlClasses() {
  return [...document.documentElement.classList].sort();
}

function expectedClasses(theme: Theme, dark: boolean) {
  const { mode, contrast } = themeClasses(theme, dark);
  return (contrast ? [mode, "contrast"] : [mode]).sort();
}

describe("theme-init.js", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  afterEach(() => {
    cleanup();
  });

  for (const theme of THEMES) {
    for (const dark of [false, true]) {
      it(`applies ${theme} (OS ${dark ? "dark" : "light"}) like the provider`, async () => {
        prefersDark(dark);
        await saveTheme(theme);

        runScript();
        expect(htmlClasses()).toEqual(expectedClasses(theme, dark));
      });
    }
  }

  it("leaves nothing for the provider to change on load", async () => {
    prefersDark(true);
    await saveTheme("dark-contrast");
    runScript();
    const before = htmlClasses();

    // Imported after saveTheme so it shares that fresh store.
    const { ThemeProvider } = await import("./index");
    render(
      <ThemeProvider>
        <span />
      </ThemeProvider>,
    );
    expect(htmlClasses()).toEqual(before);
  });

  it("falls back to light without a saved or valid theme", () => {
    prefersDark(true);
    runScript();
    expect(htmlClasses()).toEqual(["light"]);

    localStorage.setItem("user-preferences", "{not json");
    runScript();
    expect(htmlClasses()).toEqual(["light"]);
  });

  it("still applies a theme when storage cannot be read", () => {
    prefersDark(false);
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    document.documentElement.className = "dark contrast";
    runScript();
    expect(htmlClasses()).toEqual(["light"]);
    getItem.mockRestore();
  });
});
