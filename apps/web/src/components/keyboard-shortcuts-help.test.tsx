import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsHelp } from "./keyboard-shortcuts-help";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

afterEach(() => cleanup());

const title = "navigation:keyboardShortcuts.title";

describe("KeyboardShortcutsHelp", () => {
  it("opens on ? from the page", () => {
    render(<KeyboardShortcutsHelp />);
    act(() => {
      fireEvent.keyDown(document.body, { key: "?" });
    });
    expect(screen.getByText(title)).toBeTruthy();
  });

  it("leaves ? to a widget with its own shortcuts, such as a whiteboard", () => {
    render(
      <>
        <div role="application" data-testid="board" />
        <KeyboardShortcutsHelp />
      </>,
    );
    act(() => {
      fireEvent.keyDown(screen.getByTestId("board"), { key: "?" });
    });
    expect(screen.queryByText(title)).toBeNull();
  });

  it("leaves a ? another handler already took", () => {
    render(<KeyboardShortcutsHelp />);
    const taken = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener("keydown", taken, true);
    act(() => {
      fireEvent.keyDown(document.body, { key: "?" });
    });
    window.removeEventListener("keydown", taken, true);
    expect(screen.queryByText(title)).toBeNull();
  });
});
