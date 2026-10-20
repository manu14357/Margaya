import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AiBudgetBanner from "./ai-budget-banner";

const m = vi.hoisted(() => ({
  status: null as null | Record<string, unknown>,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { resolvedLanguage: "en-US", language: "en-US" },
  }),
}));
vi.mock("@/fetchers/ai/budget", () => ({
  getAiBudgetStatus: async () => m.status,
}));

afterEach(cleanup);

function renderBanner() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AiBudgetBanner workspaceId="ws-1" />
    </QueryClientProvider>,
  );
}

describe("AI budget banner", () => {
  it("warns from 80% with the amounts for managers", async () => {
    m.status = {
      monthlyCapMicros: 10_000_000,
      usedMicros: 8_500_000,
      usedPercent: 85,
      warning: true,
      month: "2026-10",
    };
    renderBanner();
    expect(
      await screen.findByText(/ai:budget.warningTitle .*85/),
    ).toBeInTheDocument();
    expect(screen.getByText(/ai:budget.amounts/)).toBeInTheDocument();
    expect(screen.getByText(/ai:budget.warningHint/)).toBeInTheDocument();
  });

  it("says the budget is used up from 100%", async () => {
    m.status = {
      monthlyCapMicros: null,
      usedMicros: null,
      usedPercent: 104,
      warning: true,
      month: "2026-10",
    };
    renderBanner();
    expect(
      await screen.findByText("ai:budget.reachedTitle"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ai:budget.amounts/)).toBeNull();
  });

  it("shows nothing below the warning", async () => {
    m.status = {
      monthlyCapMicros: null,
      usedMicros: null,
      usedPercent: 40,
      warning: false,
      month: "2026-10",
    };
    renderBanner();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/ai:budget/)).toBeNull();
  });
});
