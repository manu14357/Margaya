import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "@/components/ui/timeline";
import Activity from "../activity/index";
import { estimateActivitySentence } from "./estimate-activity-text";
import { testTranslate } from "./test-fixtures";

// Spells the sentence out so the formatted values are visible.
function t(key: string, options: Record<string, unknown> = {}) {
  if (key.startsWith("activity:estimate")) {
    const parts = [key];
    if ("from" in options) parts.push(`from=${options.from}`);
    if ("to" in options) parts.push(`to=${options.to}`);
    return parts.join(" ");
  }
  return testTranslate(key, options);
}

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t }),
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

describe("estimateActivitySentence", () => {
  it("says the estimate was set, with the points unit", () => {
    expect(
      estimateActivitySentence(
        {
          oldPointId: null,
          newPointId: "p1",
          oldValue: null,
          newValue: "5",
          oldType: null,
          newType: "points",
        },
        t,
      ),
    ).toBe("activity:estimateSet to=5 pts");
  });

  it("formats time values from minutes across a switch", () => {
    expect(
      estimateActivitySentence(
        {
          oldValue: "M",
          newValue: "90",
          oldType: "categories",
          newType: "time",
          reason: "system_switched",
        },
        t,
      ),
    ).toBe("activity:estimateChanged from=M to=1h 30m");
  });

  it("says the estimate was removed", () => {
    expect(
      estimateActivitySentence(
        { oldValue: "8", newValue: null, oldType: "points", newType: null },
        t,
      ),
    ).toBe("activity:estimateRemoved from=8 pts");
  });
});

describe("estimate_changed in the activity feed", () => {
  it("renders the sentence with the reason", () => {
    render(
      <Timeline>
        <Activity
          step={1}
          activity={{
            id: "activity-1",
            type: "estimate_changed",
            content: null,
            eventData: {
              oldPointId: "p1",
              newPointId: null,
              oldValue: "3",
              newValue: null,
              oldType: "points",
              newType: null,
              reason: "point_deleted",
            },
            createdAt: "2026-09-01T10:00:00.000Z",
            userId: "user-1",
            taskId: "task-1",
          }}
        />
      </Timeline>,
    );
    expect(
      screen.getByText(/activity:estimateRemoved from=3 pts/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("activity:estimateReason.point_deleted"),
    ).toBeInTheDocument();
  });
});
