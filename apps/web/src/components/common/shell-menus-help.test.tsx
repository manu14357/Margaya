import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GITHUB_REPOSITORY_URL } from "@/constants/urls";
import { HelpMenu } from "./shell-menus";

const state = vi.hoisted(() => ({
  config: undefined as { sourceCodeUrl: string } | undefined,
  feedback: false,
  openFeedback: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/components/version-display", () => ({
  APP_VERSION: "1.0.0",
  CHANGELOG_URL: "https://example.com/changelog",
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: state.config }),
}));
vi.mock("@/components/feedback/feedback-host", () => ({
  useFeedbackAvailable: () => state.feedback,
}));
vi.mock("@/components/feedback/feedback-dialog-store", () => ({
  openFeedbackDialog: state.openFeedback,
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  state.config = undefined;
  state.feedback = false;
  state.openFeedback.mockReset();
});

async function openHelp() {
  render(<HelpMenu trigger={<button type="button">help</button>} />);
  fireEvent.click(screen.getByRole("button", { name: "help" }));
  return screen.findByRole("menuitem", { name: "navigation:shell.sourceCode" });
}

describe("HelpMenu source code link", () => {
  it("opens the instance's source code from the config", async () => {
    state.config = { sourceCodeUrl: "https://git.example.com/acme/margaya" };
    const item = await openHelp();
    expect(item.closest("a") ?? item).toHaveAttribute(
      "href",
      "https://git.example.com/acme/margaya",
    );
  });

  it("falls back to the official repository before the config loads", async () => {
    const item = await openHelp();
    expect(item.closest("a") ?? item).toHaveAttribute(
      "href",
      GITHUB_REPOSITORY_URL,
    );
  });
});

describe("HelpMenu Send feedback", () => {
  it("opens the feedback dialog when the instance has feedback on", async () => {
    state.feedback = true;
    await openHelp();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "settings:feedback.send.menuItem" }),
    );
    expect(state.openFeedback).toHaveBeenCalled();
  });

  it("is absent when the instance has feedback off", async () => {
    await openHelp();
    expect(
      screen.queryByRole("menuitem", {
        name: "settings:feedback.send.menuItem",
      }),
    ).toBeNull();
  });
});
