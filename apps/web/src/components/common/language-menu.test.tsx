import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserPreferencesStore } from "@/store/user-preferences";

const m = vi.hoisted(() => {
  const i18n = {
    language: "en-US",
    resolvedLanguage: "en-US",
    loadLanguages: vi.fn(async () => {}),
    changeLanguage: vi.fn(async (language: string) => {
      i18n.language = language;
      i18n.resolvedLanguage = language;
    }),
  };
  return { i18n, setGuestLocale: vi.fn() };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: m.i18n,
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${Object.values(values).join(" ")}` : key,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, ...props }: { to: string }) => <a href={to} {...props} />,
}));
vi.mock("@/lib/i18n", () => ({
  resolveLocale: (locale: string | null) => locale ?? "en-US",
  setGuestLocale: m.setGuestLocale,
}));

const { LanguageMenu, ThemeMenu } = await import("./language-menu");
const { AuthLayout } = await import("@/components/auth/layout");

beforeEach(() => {
  m.i18n.language = "en-US";
  m.i18n.resolvedLanguage = "en-US";
  vi.clearAllMocks();
  useUserPreferencesStore.setState({ theme: "light" });
});

afterEach(cleanup);

describe("LanguageMenu", () => {
  it("lists every locale by its own name and switches the app language", async () => {
    render(<LanguageMenu />);

    const trigger = screen.getByRole("button", {
      name: "common:preferences.languageCurrent English",
    });
    fireEvent.click(trigger);
    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items).toHaveLength(20);
    expect(
      within(menu).getByRole("menuitemradio", { name: "日本語" }),
    ).toHaveAttribute("lang", "ja-JP");

    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitemradio", { name: "Deutsch" }),
      );
    });

    expect(m.setGuestLocale).toHaveBeenCalledWith("de-DE");
    expect(m.i18n.loadLanguages).toHaveBeenCalledWith("de-DE");
    expect(m.i18n.changeLanguage).toHaveBeenCalledWith("de-DE");
    expect(document.documentElement.lang).toBe("de-DE");
  });
});

describe("ThemeMenu", () => {
  it("sets the app theme", async () => {
    render(<ThemeMenu />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "common:preferences.themeCurrent settings:preferencesPage.themeLight",
      }),
    );
    const menu = await screen.findByRole("menu");
    fireEvent.click(
      within(menu).getByRole("menuitemradio", {
        name: "settings:preferencesPage.themeDark",
      }),
    );

    expect(useUserPreferencesStore.getState().theme).toBe("dark");
  });
});

describe("AuthLayout", () => {
  it("offers the language and theme menus on every auth page", () => {
    render(
      <AuthLayout title="Sign in">
        <form />
      </AuthLayout>,
    );

    expect(
      screen.getByRole("button", {
        name: "common:preferences.languageCurrent English",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "common:preferences.themeCurrent settings:preferencesPage.themeLight",
      }),
    ).toBeInTheDocument();
  });
});
