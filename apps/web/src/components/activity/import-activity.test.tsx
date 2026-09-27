import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "@/components/ui/timeline";
import Activity from "./index";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: { key?: string }) =>
      options?.key ? `${key}:${options.key}` : key,
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

describe("import activity entries", () => {
  it("names the Jira issue a task was imported from", () => {
    render(
      <Timeline>
        <Activity
          step={1}
          activity={{
            id: "activity-1",
            type: "imported",
            content: "Imported from Jira WEB-12",
            eventData: { source: "jira", key: "WEB-12" },
            createdAt: "2026-03-01T10:00:00.000Z",
            userId: "user-1",
            taskId: "task-1",
          }}
        />
      </Timeline>,
    );
    expect(
      screen.getByText("activity:importedFromJira:WEB-12"),
    ).toBeInTheDocument();
  });
});
