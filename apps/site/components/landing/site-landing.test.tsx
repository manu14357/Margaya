import { LandingFooter, LandingNavbar } from "@margaya/landing";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALE_STORAGE_KEY, resetLandingPrefs } from "@/lib/landing-prefs";
import { THEME_STORAGE_KEY } from "@/lib/landing-theme";
import { SiteLandingProviders } from "./site-landing";

beforeEach(() => {
  resetLandingPrefs();
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.lang = "en";
  vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        home: { nav: { getStarted: "Loslegen", signIn: "Anmelden" } },
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SiteLandingProviders", () => {
  it("switches a localized page's language and remembers it", async () => {
    render(
      <SiteLandingProviders localized>
        <LandingNavbar />
        <LandingFooter />
      </SiteLandingProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Language: English" }));
    const menu = screen.getByRole("menu");
    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitemradio", { name: "Deutsch" }),
      );
    });

    await waitFor(() =>
      expect(screen.getAllByText("Loslegen").length).toBeGreaterThan(0),
    );
    expect(fetch).toHaveBeenCalledWith("/landing-copy/de-DE.json");
    expect(document.documentElement.lang).toBe("de-DE");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("de-DE");
    expect(
      (screen.getByRole("combobox", { name: "Language" }) as HTMLSelectElement)
        .value,
    ).toBe("de-DE");

    cleanup();
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps other pages English, with the theme but no language control", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "de-DE");
    render(
      <SiteLandingProviders>
        <LandingNavbar />
      </SiteLandingProviders>,
    );

    expect(screen.queryByRole("button", { name: /Language/ })).toBeNull();
    expect(screen.getAllByText("Get started").length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Theme: Light" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByRole("button", { name: "Theme: Dark" })).toBeTruthy();
  });
});
