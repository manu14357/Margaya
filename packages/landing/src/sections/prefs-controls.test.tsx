import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../i18n/en-US.json";
import { LandingProviders } from "../landing-page";
import type { LandingLinks } from "../links";
import { LANDING_LOCALES, type LandingPrefs } from "../prefs";
import { LandingFooter } from "./footer";
import { LandingNavbar } from "./navbar";

const copy = messages.landing;

const links: LandingLinks = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  selfHost: "/docs/install",
  docs: "/docs",
  apiReference: "/docs/api",
  pricing: "/pricing",
  github: "https://example.com/margaya",
  features: {
    plan: "/features/plan",
    views: "/features/views",
    ai: "/features/ai",
    docs: "/features/docs",
    automate: "/features/automate",
    selfHost: "/features/self-host",
  },
};

function makePrefs(overrides: Partial<LandingPrefs> = {}): LandingPrefs {
  return {
    locale: "en-US",
    locales: LANDING_LOCALES,
    setLocale: vi.fn(),
    theme: "system",
    setTheme: vi.fn(),
    ...overrides,
  };
}

function renderWith(children: ReactNode, prefs?: LandingPrefs) {
  return render(
    <LandingProviders copy={copy} links={links} prefs={prefs}>
      {children}
    </LandingProviders>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("landing preference controls", () => {
  it("renders no controls when the host provides no preferences", () => {
    renderWith(
      <>
        <LandingNavbar />
        <LandingFooter />
      </>,
    );

    expect(screen.queryByRole("button", { name: /Language/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Theme/ })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("lists every locale by its native name and picks one", () => {
    const prefs = makePrefs({ locale: "de-DE" });
    renderWith(<LandingNavbar />, prefs);

    const button = screen.getByRole("button", { name: "Language: Deutsch" });
    fireEvent.click(button);

    const menu = screen.getByRole("menu", { name: "Language: Deutsch" });
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items).toHaveLength(20);
    expect(items.map((item) => item.textContent)).toEqual(
      expect.arrayContaining(["English", "Deutsch", "Français", "日本語"]),
    );
    const japanese = within(menu).getByRole("menuitemradio", {
      name: "日本語",
    });
    expect(japanese.getAttribute("lang")).toBe("ja-JP");
    expect(
      within(menu)
        .getByRole("menuitemradio", { name: "Deutsch" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(japanese);
    expect(prefs.setLocale).toHaveBeenCalledWith("ja-JP");
    expect(menu.hidden).toBe(true);
  });

  it("moves through the menu with the keyboard and closes on Escape", () => {
    const prefs = makePrefs({ locale: "en-US" });
    renderWith(<LandingNavbar />, prefs);

    const button = screen.getByRole("button", { name: "Language: English" });
    fireEvent.keyDown(button, { key: "ArrowDown" });

    const menu = screen.getByRole("menu");
    expect(menu.hidden).toBe(false);
    // Opening focuses the current choice.
    expect(document.activeElement?.textContent).toBe("English");

    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Azərbaycanca");
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement?.textContent).toBe("简体中文");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("English");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    // Wraps from the first choice to the last.
    expect(document.activeElement?.textContent).toBe("Tiếng Việt");

    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(prefs.setLocale).not.toHaveBeenCalled();
  });

  it("switches the theme from the navbar menu", () => {
    const prefs = makePrefs({ theme: "light" });
    renderWith(<LandingNavbar />, prefs);

    fireEvent.click(screen.getByRole("button", { name: "Theme: Light" }));
    const menu = screen.getByRole("menu", { name: "Theme: Light" });
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["Light", "Dark", "System"]);

    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Dark" }));
    expect(prefs.setTheme).toHaveBeenCalledWith("dark");
  });

  it("offers theme radios and a language select in the mobile menu", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const prefs = makePrefs({ theme: "dark" });
    renderWith(<LandingNavbar />, prefs);

    fireEvent.click(
      screen.getByRole("button", { name: copy.home.nav.openMenu }),
    );

    const group = screen.getByRole("group", { name: "Theme" });
    const dark = within(group).getByRole("radio", {
      name: "Dark",
    }) as HTMLInputElement;
    expect(dark.checked).toBe(true);

    fireEvent.click(within(group).getByRole("radio", { name: "Light" }));
    expect(prefs.setTheme).toHaveBeenCalledWith("light");

    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "fr-FR" },
    });
    expect(prefs.setLocale).toHaveBeenCalledWith("fr-FR");
  });

  it("puts a language select in the footer", () => {
    const prefs = makePrefs({ locale: "ja-JP" });
    renderWith(<LandingFooter />, prefs);

    const select = screen.getByRole("combobox", {
      name: "Language",
    }) as HTMLSelectElement;
    expect(select.value).toBe("ja-JP");
    fireEvent.change(select, { target: { value: "de-DE" } });
    expect(prefs.setLocale).toHaveBeenCalledWith("de-DE");
  });

  it("hides the language controls but keeps the theme with one locale", () => {
    const prefs = makePrefs({ locales: [] });
    renderWith(
      <>
        <LandingNavbar />
        <LandingFooter />
      </>,
      prefs,
    );

    expect(screen.queryByRole("button", { name: /Language/ })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "Theme: System" })).toBeTruthy();
  });
});
