import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ProjectLayoutView, ProjectViewTabs } from "./project-view-tabs";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-keyboard-shortcuts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-keyboard-shortcuts")>()),
  useRegisterShortcuts: () => {},
}));

afterEach(cleanup);

function renderTabs(activeView: ProjectLayoutView) {
  const onSelectView = vi.fn();
  render(
    <ProjectViewTabs
      projectId="p"
      workspaceId="w"
      sections={[]}
      activeSection="tasks"
      activeView={activeView}
      onSelectView={onSelectView}
      onSelectSection={vi.fn()}
    />,
  );
  return onSelectView;
}

describe("ProjectViewTabs", () => {
  it("lists List as a tab of its own, right after Board", () => {
    renderTabs("board");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "navigation:shell.backlog",
      "tasks:view.board",
      "tasks:view.list",
      "tasks:view.spreadsheet",
      "tasks:calendar.title",
      "tasks:view.gantt",
    ]);
  });

  it("selects only the List tab while the list is showing", () => {
    renderTabs("list");
    const selected = screen
      .getAllByRole("tab")
      .filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected.map((tab) => tab.textContent)).toEqual(["tasks:view.list"]);
  });

  it("asks for the list when its tab is clicked", () => {
    const onSelectView = renderTabs("board");
    fireEvent.click(screen.getByRole("tab", { name: "tasks:view.list" }));
    expect(onSelectView).toHaveBeenCalledWith("list");
  });
});
