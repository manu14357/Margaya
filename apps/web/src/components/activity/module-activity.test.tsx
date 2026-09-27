import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "@/components/ui/timeline";
import Activity from "./index";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));

vi.mock("@/hooks/queries/workspace-users/use-get-workspace-users", () => ({
  default: () => ({
    data: [{ user: { id: "user-1", name: "Ada", image: null } }],
  }),
}));

afterEach(() => cleanup());

function renderActivity(type: string, eventData: Record<string, unknown>) {
  render(
    <Timeline>
      <Activity
        step={1}
        activity={{
          id: "activity-1",
          type,
          content: null,
          eventData,
          createdAt: "2026-03-01T10:00:00.000Z",
          userId: "user-1",
          taskId: "task-1",
        }}
      />
    </Timeline>,
  );
}

describe("module activity entries", () => {
  it("says which module the task joined", () => {
    renderActivity("module_added", {
      moduleId: "module-1",
      moduleName: "Billing v2",
    });
    expect(
      screen.getByText("activity:addedToModule:Billing v2"),
    ).toBeInTheDocument();
  });

  it("says which module the task left, deleted modules included", () => {
    renderActivity("module_removed", {
      moduleId: "module-1",
      moduleName: "Billing v2",
      reason: "module_deleted",
    });
    expect(
      screen.getByText("activity:removedFromModule:Billing v2"),
    ).toBeInTheDocument();
  });
});
