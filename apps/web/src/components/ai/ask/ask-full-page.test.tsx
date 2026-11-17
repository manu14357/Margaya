import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AskFullPage } from "./ask-full-page";

const mocks = vi.hoisted(() => ({
  availability: { available: false, isLoading: false },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => mocks.availability,
}));
vi.mock("@/components/common/layout", () => {
  const Layout = () => null;
  Layout.TopBar = ({ title }: { title: string }) => (
    <header data-slot="top-bar">
      <h1>{title}</h1>
    </header>
  );
  return { default: Layout };
});

afterEach(() => {
  cleanup();
});

describe("AskFullPage", () => {
  it("keeps a top bar, the window's title row, when AI is unavailable", () => {
    mocks.availability = { available: false, isLoading: false };
    const { container } = render(<AskFullPage />);
    expect(container.querySelector("[data-slot='top-bar']")).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "ai:ask.title" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ai:ask.fullPageUnavailable")).toBeInTheDocument();
  });

  it("leaves the top row to the chat's own header when AI is available", () => {
    mocks.availability = { available: true, isLoading: false };
    const { container } = render(<AskFullPage />);
    expect(container.querySelector("[data-slot='top-bar']")).toBeNull();
    expect(screen.getByRole("heading", { name: "ai:ask.title" })).toHaveClass(
      "sr-only",
    );
  });
});
