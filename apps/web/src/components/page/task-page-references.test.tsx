import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskPageReferences } from "./task-page-references";

const m = vi.hoisted(() => ({
  pagesOn: true,
  canRead: true,
  pages: [] as unknown[],
  useReferences: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    className,
  }: {
    children: ReactNode;
    params: { projectId: string; pageId: string };
    className?: string;
  }) => (
    <a
      href={`/${params.projectId}/pages/${params.pageId}`}
      className={className}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/use-project-features", () => ({
  useProjectFeatures: () => ({
    isEnabled: (key: string) => key === "pages" && m.pagesOn,
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canReadPages: () => m.canRead }),
}));
vi.mock("@/hooks/queries/page/use-get-task-page-references", () => ({
  useGetTaskPageReferences: (taskId: string, enabled: boolean) => {
    m.useReferences(taskId, enabled);
    return { data: enabled ? m.pages : undefined };
  },
}));

function page(id: string, title: string, projectId = "p-1") {
  return {
    id,
    projectId,
    title,
    logoKind: "emoji",
    logoValue: "📘",
  };
}

function renderSection() {
  return render(
    <TaskPageReferences taskId="t-1" projectId="p-1" workspaceId="ws-1" />,
  );
}

describe("TaskPageReferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.pagesOn = true;
    m.canRead = true;
    m.pages = [];
  });
  afterEach(cleanup);

  it("lists the pages that mention the task, each linking to the page", () => {
    m.pages = [page("pg-1", "Release plan"), page("pg-2", "  ", "p-2")];
    renderSection();

    expect(screen.getByText("tasks:pageReferences.title")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Release plan/ })).toHaveAttribute(
      "href",
      "/p-1/pages/pg-1",
    );
    // A blank title reads as Untitled; the link uses the page's own project.
    expect(
      screen.getByRole("link", { name: /pages:list.untitled/ }),
    ).toHaveAttribute("href", "/p-2/pages/pg-2");
    expect(screen.getAllByText("📘")).toHaveLength(2);
  });

  it("renders nothing when no page mentions the task", () => {
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it("doesn't load or render while the Pages feature is off", () => {
    m.pagesOn = false;
    m.pages = [page("pg-1", "Release plan")];
    const { container } = renderSection();

    expect(container).toBeEmptyDOMElement();
    expect(m.useReferences).toHaveBeenCalledWith("t-1", false);
  });

  it("doesn't load without page read access", () => {
    m.canRead = false;
    m.pages = [page("pg-1", "Release plan")];
    const { container } = renderSection();

    expect(container).toBeEmptyDOMElement();
    expect(m.useReferences).toHaveBeenCalledWith("t-1", false);
  });
});
