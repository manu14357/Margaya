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
    getResourceBundle: vi.fn((language: string) =>
      language === "de-DE" ? { home: { nav: { pricing: "Preise" } } } : {},
    ),
    loadLanguages: vi.fn(async () => {}),
    changeLanguage: vi.fn(async (language: string) => {
      i18n.language = language;
      i18n.resolvedLanguage = language;
    }),
  };
  return { i18n, setGuestLocale: vi.fn() };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: m.i18n }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, ...props }: { to: string }) => <a href={to} {...props} />,
}));
vi.mock("@/lib/i18n", () => ({
  resolveLocale: (locale: string | null) => locale ?? "en-US",
  setGuestLocale: m.setGuestLocale,
}));
// The navbar and footer carry the controls; the demos are not needed here.
vi.mock("@margaya/landing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@margaya/landing")>();
  return {
    ...actual,
    LandingPage: () => (
      <>
        <actual.LandingNavbar />
        <actual.LandingFooter />
      </>
    ),
  };
});

const { default: PublicLanding } = await import("./public-landing");

beforeEach(() => {
  m.i18n.language = "en-US";
  m.i18n.resolvedLanguage = "en-US";
  vi.clearAllMocks();
  useUserPreferencesStore.setState({ theme: "light" });
});

afterEach(cleanup);

describe("PublicLanding preferences", () => {
  it("changes the app language and stores it for signed-out visitors", async () => {
    render(<PublicLanding />);

    fireEvent.click(screen.getByRole("button", { name: "Language: English" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(20);

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

  it("renders the current language's copy", () => {
    m.i18n.language = "de-DE";
    m.i18n.resolvedLanguage = "de-DE";
    render(<PublicLanding />);

    expect(screen.getAllByText("Preise").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Language: Deutsch" }),
    ).toBeInTheDocument();
  });

  it("uses the app's theme preference", () => {
    render(<PublicLanding />);

    fireEvent.click(screen.getByRole("button", { name: "Theme: Light" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "System" }));

    expect(useUserPreferencesStore.getState().theme).toBe("system");
    expect(
      screen.getByRole("button", { name: "Theme: System" }),
    ).toBeInTheDocument();
  });
});
