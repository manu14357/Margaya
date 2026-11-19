import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { FocusStatusButton } from "./focus-mode";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  useUserPreferencesStore.setState({
    focusUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
});

afterEach(() => {
  cleanup();
  useUserPreferencesStore.setState({ focusUntil: null });
});

describe("FocusStatusButton", () => {
  it("opens its menu, with the time as a group label, without crashing", async () => {
    render(<FocusStatusButton />);
    fireEvent.click(
      screen.getByRole("button", { name: "navigation:focus.focusUntil" }),
    );

    const menu = await screen.findByRole("menu");
    const group = within(menu).getByRole("group");
    expect(
      within(group).getByText("navigation:focus.focusUntil"),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "navigation:focus.resume" }),
    ).toBeInTheDocument();
  });
});
