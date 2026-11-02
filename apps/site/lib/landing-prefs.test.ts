import { LANDING_LOCALES } from "@margaya/landing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LANDING_COPY_LOADERS } from "./landing-locales";
import {
  getLocaleState,
  getTheme,
  LOCALE_STORAGE_KEY,
  resetLandingPrefs,
  resolveLocale,
  setLocale,
  setTheme,
  startLocale,
} from "./landing-prefs";
import { THEME_STORAGE_KEY, themeScript } from "./landing-theme";

function stubBrowser({
  languages = ["en-US"],
  dark = false,
  bundle = { home: { nav: { getStarted: "Loslegen" } } },
}: {
  languages?: string[];
  dark?: boolean;
  bundle?: unknown;
} = {}) {
  vi.stubGlobal("navigator", { language: languages[0], languages });
  vi.stubGlobal("matchMedia", () => ({
    matches: dark,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  const fetchMock = vi.fn(async () => Response.json(bundle));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetLandingPrefs();
  localStorage.clear();
  document.documentElement.className = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("site landing preferences", () => {
  it("serves a bundle for every locale except the bundled English", () => {
    expect(Object.keys(LANDING_COPY_LOADERS).sort()).toEqual(
      LANDING_LOCALES.map((locale) => locale.code)
        .filter((code) => code !== "en-US")
        .sort(),
    );
  });

  it("matches browser languages exactly, then by language", () => {
    expect(resolveLocale(["de-AT"])).toBe("de-DE");
    expect(resolveLocale(["pt-PT"])).toBe("pt-BR");
    expect(resolveLocale(["ja"])).toBe("ja-JP");
    expect(resolveLocale(["xx-YY", "fr-CA"])).toBe("fr-FR");
    expect(resolveLocale(["xx"])).toBeNull();
  });

  it("picks the browser language on a first visit without storing it", async () => {
    const fetchMock = stubBrowser({ languages: ["de-AT", "en"] });

    await startLocale();

    expect(fetchMock).toHaveBeenCalledWith("/landing-copy/de-DE.json");
    const state = getLocaleState();
    expect(state.locale).toBe("de-DE");
    expect(state.copy.home.nav.getStarted).toBe("Loslegen");
    // Untranslated keys fall back to English.
    expect(state.copy.home.nav.docs).toBe("Docs");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it("prefers the stored language and stays English without a match", async () => {
    const fetchMock = stubBrowser({ languages: ["xx-YY"] });
    await startLocale();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getLocaleState().locale).toBe("en-US");

    resetLandingPrefs();
    localStorage.setItem(LOCALE_STORAGE_KEY, "ja-JP");
    await startLocale();
    expect(fetchMock).toHaveBeenCalledWith("/landing-copy/ja-JP.json");
    expect(getLocaleState().locale).toBe("ja-JP");
  });

  it("persists a picked language and keeps the current one if loading fails", async () => {
    const fetchMock = stubBrowser();
    await setLocale("fr-FR");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("fr-FR");
    expect(getLocaleState().locale).toBe("fr-FR");

    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    await setLocale("it-IT");
    expect(getLocaleState().locale).toBe("fr-FR");

    await setLocale("en-US");
    expect(getLocaleState().locale).toBe("en-US");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stores the theme and applies it to the document", () => {
    stubBrowser({ dark: true });
    // Light by default, even when the OS prefers dark.
    expect(getTheme()).toBe("light");

    setTheme("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");

    setTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    resetLandingPrefs();
    expect(getTheme()).toBe("system");
    localStorage.removeItem(THEME_STORAGE_KEY);
    resetLandingPrefs();
    expect(getTheme()).toBe("light");
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    resetLandingPrefs();
    expect(getTheme()).toBe("dark");
  });

  it("applies the stored theme before hydration", () => {
    stubBrowser({ dark: true });
    // No stored choice: light, whatever the OS prefers.
    new Function(themeScript)();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");

    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    new Function(themeScript)();
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    localStorage.setItem(THEME_STORAGE_KEY, "light");
    new Function(themeScript)();
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    localStorage.setItem(THEME_STORAGE_KEY, "system");
    new Function(themeScript)();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
