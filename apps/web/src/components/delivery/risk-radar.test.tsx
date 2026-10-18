import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeRisksWidget from "./home-risks-widget";
import RiskRadar from "./risk-radar";

const m = vi.hoisted(() => ({
  risks: {} as Record<string, unknown>,
  home: {} as Record<string, unknown>,
  canReadAnalytics: true,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && Object.keys(options).length > 0
        ? `${key}(${Object.entries(options)
            .map(([name, value]) => `${name}=${value}`)
            .join(",")})`
        : key,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    title,
  }: {
    children: ReactNode;
    params: { taskId: string };
    title?: string;
  }) => (
    <a href={`/task/${params.taskId}`} title={title}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/queries/delivery/use-delivery", () => ({
  useRisks: () => m.risks,
  useHomeRisks: () => m.home,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canReadAnalytics: () => m.canReadAnalytics,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/components/module/module-people", () => ({
  useWorkspacePeople: () => [{ id: "u1", name: "Ana", image: null }],
  resolvePeople: (ids: string[], people: Array<{ id: string }>) =>
    people.filter((person) => ids.includes(person.id)),
}));
vi.mock("@/lib/cycle/dates", () => ({
  formatCycleDate: (day: string) => `D:${day}`,
}));

const task = (id: string, number: number, title: string) => ({
  id,
  projectId: "p1",
  projectSlug: "web",
  number,
  title,
  status: "to-do",
  dueDate: null,
  assigneeIds: [],
});

function radar(overrides: Record<string, unknown> = {}) {
  return {
    scope: { type: "cycle", id: "c1", projectId: "p1", endDate: "2026-10-25" },
    today: "2026-10-21",
    truncated: false,
    hiddenBlockers: 1,
    history: { cycleTime: { samples: 12, p50Days: 2, p85Days: 4 } },
    criticalPath: {
      taskIds: ["t1", "t2"],
      hiddenCount: 0,
      total: 6,
      unit: "days",
      finishDate: "2026-10-26",
      slackDays: -1,
    },
    signals: [
      {
        kind: "critical_path",
        severity: "high",
        taskIds: ["t1", "t2"],
        total: 2,
        deadline: "2026-10-25",
        finishDate: "2026-10-26",
      },
      {
        kind: "blocked_chain",
        severity: "medium",
        taskIds: ["t2"],
        total: 1,
        headTaskId: null,
        depth: 1,
      },
      {
        kind: "overdue_cluster",
        severity: "medium",
        taskIds: ["t1"],
        total: 3,
        assigneeId: "u1",
      },
    ],
    tasks: [task("t1", 1, "Design"), task("t2", 2, "Build")],
    ...overrides,
  };
}

beforeEach(() => {
  m.canReadAnalytics = true;
  m.risks = {
    data: radar(),
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
});
afterEach(() => cleanup());

describe("RiskRadar", () => {
  it("lists each signal as a sentence with links to its tasks", () => {
    render(<RiskRadar workspaceId="w1" projectId="p1" scope="cycle" id="c1" />);
    expect(
      screen.getByText(
        "delivery:risks.kinds.critical_path_late(date=D:2026-10-26,deadline=D:2026-10-25)",
      ),
    ).toBeInTheDocument();
    // A blocker in a project you can't see is never named.
    expect(
      screen.getByText(
        "delivery:risks.kinds.blocked_chain(count=1,head=delivery:risks.hiddenTask)",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "delivery:risks.kinds.overdue_cluster(count=3,name=Ana)",
      ),
    ).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/task/t1");
    expect(links[0]).toHaveTextContent("WEB-1 Design");
    expect(screen.getAllByText("delivery:risks.severity.high:")).toHaveLength(
      1,
    );
    expect(
      screen.getByText(
        "delivery:risks.criticalPath.chain(count=2) · delivery:risks.criticalPath.ends(date=D:2026-10-26)",
      ),
    ).toBeInTheDocument();
  });

  it("collapses long lists and shows the empty state", () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      kind: "overdue",
      severity: "low",
      taskIds: [],
      total: index + 1,
    }));
    m.risks = {
      data: radar({ signals: many }),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<RiskRadar workspaceId="w1" projectId="p1" scope="cycle" id="c1" />);
    expect(screen.getAllByText(/delivery:risks.kinds.overdue/)).toHaveLength(5);
    fireEvent.click(
      screen.getByRole("button", { name: "delivery:risks.showAll(total=7)" }),
    );
    expect(screen.getAllByText(/delivery:risks.kinds.overdue/)).toHaveLength(7);
    cleanup();

    m.risks = {
      data: radar({
        signals: [],
        criticalPath: null,
        history: { cycleTime: { samples: 2, p50Days: null, p85Days: null } },
      }),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<RiskRadar workspaceId="w1" projectId="p1" scope="cycle" id="c1" />);
    expect(screen.getByText("delivery:risks.empty")).toBeInTheDocument();
    expect(screen.getByText("delivery:risks.noCycleTime")).toBeInTheDocument();
  });
});

describe("HomeRisksWidget", () => {
  it("shows the top risks with their project and cycle", () => {
    m.home = {
      data: {
        today: "2026-10-21",
        cycles: 1,
        signals: [
          {
            kind: "overdue",
            severity: "low",
            taskIds: ["t1"],
            total: 1,
            projectId: "p1",
            projectName: "Web",
            cycleId: "c1",
            cycleName: "Sprint 4",
          },
        ],
        tasks: [task("t1", 1, "Design")],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<HomeRisksWidget workspaceId="w1" />);
    expect(screen.getByText("delivery:home.title")).toBeInTheDocument();
    expect(
      screen.getByText("delivery:home.context(project=Web,cycle=Sprint 4)"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/task/t1");
  });

  it("renders nothing without analytics:read, and an empty state otherwise", () => {
    m.canReadAnalytics = false;
    const { container } = render(<HomeRisksWidget workspaceId="w1" />);
    expect(container).toBeEmptyDOMElement();
    cleanup();

    m.canReadAnalytics = true;
    m.home = {
      data: { today: "2026-10-21", cycles: 0, signals: [], tasks: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<HomeRisksWidget workspaceId="w1" />);
    expect(screen.getByText("delivery:home.empty")).toBeInTheDocument();
  });
});
