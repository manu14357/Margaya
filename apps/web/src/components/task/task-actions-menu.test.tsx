import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskActionsMenu from "./task-actions-menu";

const mocks = vi.hoisted(() => ({
  overflow: null as
    | null
    | { id: string; label: string; onSelect: () => void }[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/common/header/top-bar-overflow", () => ({
  useTopBarOverflowHost: () =>
    mocks.overflow?.map((item) => ({ ...item, icon: null })) ?? null,
}));
vi.mock("@/hooks/queries/task/use-get-task", () => ({
  default: () => ({ data: { projectId: "project-1", number: 6 } }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: { id: "project-1", slug: "WEB" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canCreateTasks: () => true }),
}));
vi.mock("@/store/copy-task-dialog", () => ({
  default: () => vi.fn(),
}));

afterEach(() => {
  cleanup();
  mocks.overflow = null;
});

function openMenu() {
  render(
    <TaskActionsMenu taskId="task-1" projectId="project-1" workspaceId="w" />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "tasks:actions.moreActions" }),
  );
}

describe("TaskActionsMenu", () => {
  it("lists only the task's own actions while the top bar has room", async () => {
    openMenu();

    expect(await screen.findByText("tasks:actions.copyLink")).toBeTruthy();
    expect(screen.queryByText("Ask AI")).toBeNull();
  });

  it("takes in the crowded top bar's actions, so there is one menu, not two", async () => {
    const ask = vi.fn();
    mocks.overflow = [{ id: "ask", label: "Ask AI", onSelect: ask }];
    openMenu();

    fireEvent.click(await screen.findByText("Ask AI"));
    expect(ask).toHaveBeenCalledOnce();
  });
});
