import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CycleCapacity } from "@/fetchers/insight/insight";
import { CapacitySummary } from "./cycle-capacity-check";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

afterEach(cleanup);

const base: CycleCapacity = {
  cycleId: "c",
  plannedDays: 10,
  basis: "cycles",
  historyCycles: 2,
  unit: "tasks",
  estimateType: null,
  committed: { tasks: 6, estimatedTasks: 0, points: null },
  capacity: { low: 2, typical: 2, high: 2 },
  load: 6,
  percent: 300,
  status: "over",
  deferrals: [
    {
      id: "t1",
      key: "WEB-1",
      title: "Polish",
      priority: "low",
      size: 1,
      dependants: 2,
    },
  ],
  members: [
    {
      userId: "u",
      name: "Mia",
      tasks: 6,
      points: null,
      typical: 2,
      status: "over",
    },
  ],
};

describe("CapacitySummary", () => {
  it("warns when the plan is over a usual cycle and lists deferrals", () => {
    render(<CapacitySummary capacity={base} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      'insight:capacity.over:{"percent":300}',
    );
    expect(screen.getByText("WEB-1")).toBeInTheDocument();
    expect(screen.getByText("Mia")).toBeInTheDocument();
  });

  it("stays quiet within capacity and explains missing history", () => {
    const { unmount } = render(
      <CapacitySummary
        capacity={{
          ...base,
          load: 2,
          percent: 100,
          status: "ok",
          deferrals: [],
          members: null,
        }}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.getByText('insight:capacity.within:{"percent":100}'),
    ).toBeInTheDocument();
    unmount();
    render(
      <CapacitySummary
        capacity={{ ...base, capacity: null, load: null, status: "unknown" }}
      />,
    );
    expect(screen.getByText("insight:capacity.noHistory")).toBeInTheDocument();
  });

  it("does not show 0% when no comparable work was finished yet", () => {
    render(
      <CapacitySummary
        capacity={{
          ...base,
          capacity: { low: 0, typical: 0, high: 0 },
          percent: null,
          status: "over",
        }}
      />,
    );
    expect(screen.getByText("insight:capacity.noHistory")).toBeInTheDocument();
    expect(screen.queryByText(/insight:capacity.over/)).not.toBeInTheDocument();
  });
});
