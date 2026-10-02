import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { SnoozeIntakeOptions } from "./snooze-intake-popover";

// Dialogs and menus render slowly on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Wednesday, September 16, 2026, mid-afternoon.
  vi.setSystemTime(new Date(2026, 8, 16, 15, 30));
  useUserPreferencesStore.setState({ weekStartsOn: 1 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function picked(onPick: ReturnType<typeof vi.fn>) {
  const value = onPick.mock.calls[0]?.[0] as Date;
  return [
    value.getFullYear(),
    value.getMonth() + 1,
    value.getDate(),
    value.getHours(),
    value.getMinutes(),
  ];
}

describe("SnoozeIntakeOptions", () => {
  it("snoozes until the start of tomorrow", () => {
    const onPick = vi.fn();
    render(<SnoozeIntakeOptions onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /snooze\.tomorrow/ }));
    expect(picked(onPick)).toEqual([2026, 9, 17, 0, 0]);
  });

  it("uses the week start for next week", () => {
    const onPick = vi.fn();
    render(<SnoozeIntakeOptions onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /snooze\.nextWeek/ }));
    // The next Monday.
    expect(picked(onPick)).toEqual([2026, 9, 21, 0, 0]);
  });

  it("offers in 3 days and in 2 weeks", () => {
    const onPick = vi.fn();
    render(<SnoozeIntakeOptions onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /snooze\.in2Weeks/ }));
    expect(picked(onPick)).toEqual([2026, 9, 30, 0, 0]);
  });

  it("keeps today and earlier out of the calendar", () => {
    render(<SnoozeIntakeOptions onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /snooze\.pickDate/ }));
    const dayButton = (label: string) =>
      screen
        .getAllByRole("button")
        .find((button) => button.textContent === label);
    expect(dayButton("15")).toBeDisabled();
    expect(dayButton("16")).toBeDisabled();
    expect(dayButton("17")).not.toBeDisabled();
  });
});
