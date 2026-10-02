import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SnoozeMenu from "./snooze-menu";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderMenu(isSnoozed = false) {
  const onSnooze = vi.fn();
  const onUnsnooze = vi.fn();
  render(
    <SnoozeMenu
      isSnoozed={isSnoozed}
      onSnooze={onSnooze}
      onUnsnooze={onUnsnooze}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "notifications:inbox.actions.snooze" }),
  );
  return { onSnooze, onUnsnooze };
}

describe("SnoozeMenu", () => {
  it("snoozes a preset for exactly that long from now", async () => {
    const { onSnooze } = renderMenu();
    const before = Date.now();
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: /notifications:inbox\.snooze\.threeDays/,
      }),
    );
    const after = Date.now();
    const until =
      (onSnooze.mock.calls[0]?.[0] as Date | undefined)?.getTime() ?? 0;
    const threeDays = 72 * 3_600_000;
    expect(until).toBeGreaterThanOrEqual(before + threeDays);
    expect(until).toBeLessThanOrEqual(after + threeDays);
  });

  it("offers Unsnooze only for snoozed rows", async () => {
    renderMenu(false);
    await screen.findByRole("menuitem", {
      name: /notifications:inbox\.snooze\.oneDay/,
    });
    expect(
      screen.queryByRole("menuitem", {
        name: "notifications:inbox.actions.unsnooze",
      }),
    ).toBeNull();
    cleanup();

    const { onUnsnooze } = renderMenu(true);
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "notifications:inbox.actions.unsnooze",
      }),
    );
    expect(onUnsnooze).toHaveBeenCalledOnce();
  });

  it("opens the custom snooze dialog", async () => {
    const { onSnooze } = renderMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "notifications:inbox.snooze.custom",
      }),
    );
    expect(
      await screen.findByText("notifications:inbox.snooze.dialogTitle"),
    ).toBeInTheDocument();
    // Tomorrow at 09:00 is preselected, so the dialog can submit at once.
    fireEvent.click(
      screen.getByRole("button", { name: "notifications:inbox.snooze.submit" }),
    );
    const until = onSnooze.mock.calls[0]?.[0] as Date;
    expect(until.getHours()).toBe(9);
    expect(until.getMinutes()).toBe(0);
    expect(until.getTime()).toBeGreaterThan(Date.now());
  });
});
