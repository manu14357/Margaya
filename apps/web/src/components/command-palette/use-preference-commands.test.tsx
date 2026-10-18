import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { usePreferenceCommands } from "./use-preference-commands";

const m = vi.hoisted(() => ({
  setLocale: vi.fn(() => Promise.resolve()),
  setWeekStartsOn: vi.fn(),
  updateTimezone: vi.fn((_zone: string) =>
    Promise.resolve({ timezone: "UTC" }),
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options?.zone ? `${key}:${options.zone}` : key,
  }),
}));
vi.mock("@/hooks/use-locale", () => ({
  useLocale: () => ({ locale: "en-US", setLocale: m.setLocale }),
}));
vi.mock("@/hooks/use-guest-locale", () => ({
  GUEST_LOCALES: [
    { code: "en-US", nativeName: "English" },
    { code: "ru-RU", nativeName: "Русский" },
  ],
}));
vi.mock("@/store/user-preferences", () => ({
  WEEK_START_DAYS: [0, 1, 6],
  useUserPreferencesStore: (
    select: (state: Record<string, unknown>) => unknown,
  ) => select({ weekStartsOn: 1, setWeekStartsOn: m.setWeekStartsOn }),
}));
vi.mock("@/fetchers/user/get-user-timezone", () => ({
  default: () => Promise.resolve({ timezone: "Europe/Berlin" }),
}));
vi.mock("@/fetchers/user/update-user-timezone", () => ({
  default: m.updateTimezone,
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

function render() {
  return renderHook(() => usePreferenceCommands({ open: true }), { wrapper })
    .result.current;
}

describe("usePreferenceCommands", () => {
  it("shows the current language and lists every locale", () => {
    const language = render().find(
      (item) => item.value === "preference-language",
    );
    expect(language?.hint).toBe("English");
    const submenu = language?.submenu?.();
    expect(submenu?.items.map((item) => item.label)).toEqual([
      "English",
      "Русский",
    ]);
    submenu?.items[1]?.onRun();
    expect(m.setLocale).toHaveBeenCalledWith("ru-RU");
  });

  it("changes the first day of the week", () => {
    const weekStart = render().find(
      (item) => item.value === "preference-week-start",
    );
    expect(weekStart?.hint).toBe("settings:preferencesPage.weekStartsOnMonday");
    const items = weekStart?.submenu?.().items ?? [];
    expect(items.map((item) => item.value)).toEqual([
      "week-start:0",
      "week-start:1",
      "week-start:6",
    ]);
    items[2]?.onRun();
    expect(m.setWeekStartsOn).toHaveBeenCalledWith(6);
  });

  it("offers the browser zone first, then every zone", async () => {
    const timezone = render().find(
      (item) => item.value === "preference-timezone",
    );
    const items = timezone?.submenu?.().items ?? [];
    expect(items[0]?.value).toBe("timezone:automatic");
    expect(items.some((item) => item.value === "timezone:UTC")).toBe(true);
    items.find((item) => item.value === "timezone:UTC")?.onRun();
    await waitFor(() => expect(m.updateTimezone).toHaveBeenCalled());
    expect(m.updateTimezone.mock.calls[0]?.[0]).toBe("UTC");
  });
});
