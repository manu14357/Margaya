import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsOverview } from "@/types/analytics";
import ProjectProgressCard from "./project-progress-card";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string;
    params: Record<string, string>;
    children: ReactNode;
    className?: string;
  }) => (
    <a
      className={className}
      href={Object.entries(params).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}
    >
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const overview = {
  projectRows: [
    {
      projectId: "p1",
      total: 4,
      backlog: 0,
      unstarted: 1,
      started: 0,
      completed: 3,
      cancelled: 0,
      progress: 75,
      overdue: 0,
    },
  ],
  meta: { projects: [{ id: "p1", name: "Alpha", slug: "alpha", icon: null }] },
} as unknown as AnalyticsOverview;

describe("ProjectProgressCard", () => {
  it("opens the project's analytics, not its board", () => {
    render(
      <ProjectProgressCard
        workspaceId="ws-1"
        overview={overview}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: /Alpha/ })).toHaveAttribute(
      "href",
      "/dashboard/workspace/ws-1/project/p1/analytics",
    );
  });
});
