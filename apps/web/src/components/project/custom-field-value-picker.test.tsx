import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CustomFieldValuePicker from "./custom-field-value-picker";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CustomFieldValuePicker", () => {
  it("loads the calendar for a date field and picks a day", async () => {
    // The calendar opens on the current month.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 2, 1));
    const onSelect = vi.fn();
    render(
      <CustomFieldValuePicker
        field={{ type: "date", required: false, options: null }}
        value="2026-03-10"
        onSelect={onSelect}
      />,
    );

    // The calendar loads on demand.
    await screen.findByRole("grid");
    fireEvent.click(screen.getByRole("button", { name: /March 12/ }));
    expect(onSelect).toHaveBeenCalledWith("2026-03-12");

    fireEvent.click(screen.getByText("tasks:customFieldValue.clear"));
    expect(onSelect).toHaveBeenLastCalledWith("");
  });
});
