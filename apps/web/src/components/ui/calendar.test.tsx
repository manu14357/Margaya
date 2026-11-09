import { cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { Calendar } from "./calendar";

const german = i18next.createInstance();
const english = i18next.createInstance();

beforeAll(async () => {
  await german.use(initReactI18next).init({ lng: "de-DE", resources: {} });
  await english.use(initReactI18next).init({ lng: "en-US", resources: {} });
});

afterEach(() => {
  cleanup();
  useUserPreferencesStore.setState({ weekStartsOn: 0 });
});

const october = new Date(2026, 9, 1);

function weekdayHeaders() {
  return screen
    .getAllByRole("columnheader", { hidden: true })
    .map((cell) => cell.textContent);
}

describe("Calendar", () => {
  it("names the month, weekdays and days in the app's language", async () => {
    useUserPreferencesStore.setState({ weekStartsOn: 1 });
    render(
      <I18nextProvider i18n={german}>
        <Calendar defaultMonth={october} />
      </I18nextProvider>,
    );

    expect(await screen.findByText("Oktober 2026")).toBeInTheDocument();
    expect(screen.queryByText("October 2026")).toBeNull();
    expect(weekdayHeaders()).toEqual([
      "Mo",
      "Di",
      "Mi",
      "Do",
      "Fr",
      "Sa",
      "So",
    ]);
    expect(
      screen.getByRole("button", { name: /Donnerstag, 1\. Oktober 2026/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Zum nächsten Monat" }),
    ).toBeInTheDocument();
  });

  it("lists German month names in the month dropdown", async () => {
    render(
      <I18nextProvider i18n={german}>
        <Calendar
          captionLayout="dropdown"
          defaultMonth={october}
          startMonth={new Date(2026, 0, 1)}
          endMonth={new Date(2026, 11, 1)}
        />
      </I18nextProvider>,
    );

    const months = await screen.findByRole("combobox", {
      name: "Monat auswählen",
    });
    const names = Array.from(
      months.querySelectorAll("option"),
      (option) => option.textContent,
    );
    expect(names).toContain("Okt");
    expect(names).not.toContain("Oct");
  });

  it("keeps the user's week start over the language's own", async () => {
    useUserPreferencesStore.setState({ weekStartsOn: 0 });
    render(
      <I18nextProvider i18n={german}>
        <Calendar defaultMonth={october} />
      </I18nextProvider>,
    );

    await screen.findByText("Oktober 2026");
    expect(weekdayHeaders()[0]).toBe("So");
  });

  it("stays in English for an English reader", () => {
    render(
      <I18nextProvider i18n={english}>
        <Calendar defaultMonth={october} />
      </I18nextProvider>,
    );

    expect(screen.getByText("October 2026")).toBeInTheDocument();
    expect(weekdayHeaders()[0]).toBe("Su");
  });
});
