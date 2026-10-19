import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CycleHeaderActions from "./cycle-header-actions";
import { makeCycle } from "./test-fixtures";

const m = vi.hoisted(() => ({ wide: true }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/task/use-min-width", () => ({
  useMinWidth: () => m.wide,
}));
vi.mock("@/components/ai/ai-summary", () => ({
  AiSummaryButton: () => <button type="button">summarize</button>,
}));
vi.mock("@/components/ai/brief/brief-button", () => ({
  default: () => <button type="button">brief</button>,
}));
vi.mock("@/components/insight/retro-button", () => ({
  default: () => <button type="button">retro</button>,
}));
vi.mock("@/components/favorite/favorite-button", () => ({
  default: ({ className }: { className?: string }) => (
    <button type="button" className={className}>
      favorite
    </button>
  ),
}));
vi.mock("./cycle-ai-menu", () => ({
  default: () => <button type="button">ai menu</button>,
}));
vi.mock("./cycle-row-actions", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  m.wide = true;
});

function renderHeader() {
  const noop = () => {};
  render(
    <CycleHeaderActions
      cycle={makeCycle({ status: "current" })}
      workspaceId="ws-1"
      taskCount={1}
      canAddTasks
      canPlan
      isPlanning={false}
      onTogglePlanning={noop}
      isPanelOpen
      onAddTask={noop}
      onAddExisting={noop}
      onTogglePanel={noop}
      onDeleted={noop}
    />,
  );
}

describe("CycleHeaderActions", () => {
  it("shows the AI actions side by side on wide screens", () => {
    renderHeader();
    for (const name of ["summarize", "retro", "brief"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "ai menu" })).toBeNull();
  });

  it("folds them into one AI menu below 2xl, keeping room for search", () => {
    m.wide = false;
    renderHeader();
    expect(screen.getByRole("button", { name: "ai menu" })).toBeInTheDocument();
    for (const name of ["summarize", "retro", "brief"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    // The task count and the star (also in the ⋯ menu) wait for wide screens.
    expect(screen.getByText("cycles:detail.taskCount")).toHaveClass(
      "hidden",
      "2xl:inline",
    );
    expect(screen.getByRole("button", { name: "favorite" })).toHaveClass(
      "hidden",
      "xl:inline-flex",
    );
  });
});
