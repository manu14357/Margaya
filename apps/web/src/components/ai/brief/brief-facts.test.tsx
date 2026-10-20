import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BriefFacts } from "@/fetchers/ai/brief";
import BriefFactsSummary from "./brief-facts";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/lib/format", () => ({
  formatDateMedium: (value: string) => `date(${String(value).slice(0, 10)})`,
}));

afterEach(cleanup);

const list = (total: number) => ({ total, tasks: [] });

const facts: BriefFacts = {
  scope: {
    type: "cycle",
    id: "c1",
    projectId: "p1",
    name: "Sprint 4",
    startDate: "2026-10-14",
    endDate: "2026-10-28",
  },
  generatedAt: "2026-10-21T10:00:00.000Z",
  since: "2026-10-14T10:00:00.000Z",
  truncated: false,
  counts: {
    total: 10,
    backlog: 1,
    unstarted: 2,
    started: 2,
    completed: 4,
    cancelled: 1,
  },
  percent: 44,
  completed: list(3),
  added: list(2),
  removed: list(1),
  inProgress: list(2),
  risks: [
    { kind: "ageing", severity: "medium", total: 2, tasks: [] },
    { kind: "overdue", severity: "high", total: 1, tasks: [] },
  ],
  forecast: {
    status: "ok",
    remaining: 5,
    p50: "2026-10-25",
    p85: "2026-10-30",
    p95: "2026-11-02",
    probabilityByEnd: 62,
  },
  previous: {
    briefId: "b0",
    sharedAt: "2026-10-14T10:00:00.000Z",
    percent: 20,
    forecastP85: "2026-10-27",
    risks: { ageing: 1 },
  },
};

describe("BriefFactsSummary", () => {
  it("shows the computed facts and the change since the last brief", () => {
    render(<BriefFactsSummary facts={facts} />);
    expect(
      screen.getByText(
        'ai:brief.facts.progressValue {"percent":44,"completed":4,"total":9}',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'ai:brief.facts.changes {"completed":3,"added":2,"removed":1}',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'ai:brief.facts.forecastValue {"date":"date(2026-10-30)"}',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(
      screen.getByText(
        'ai:brief.facts.progressDiff {"before":20,"now":44} · ai:brief.facts.forecastDiff {"before":"date(2026-10-27)","now":"date(2026-10-30)"}',
      ),
    ).toBeInTheDocument();
  });

  it("says when there is no earlier brief or forecast", () => {
    render(
      <BriefFactsSummary
        facts={{
          ...facts,
          previous: null,
          forecast: {
            status: "insufficient_history",
            remaining: 5,
            p50: null,
            p85: null,
            p95: null,
            probabilityByEnd: null,
          },
        }}
      />,
    );
    expect(screen.getByText("ai:brief.facts.sinceDays")).toBeInTheDocument();
    expect(screen.getByText("ai:brief.facts.forecastNone")).toBeInTheDocument();
    expect(screen.queryByText("ai:brief.facts.diff")).not.toBeInTheDocument();
  });
});
