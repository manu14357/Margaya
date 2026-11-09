import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/components/task-filters/subjects/planning-subjects";
import ProjectFilterBar from "@/components/task-filters/project-filter-bar";
import { useFilterSubjects } from "@/components/task-filters/subjects/registry";
import { useClassicBoardFilter } from "@/hooks/use-classic-board-filter";
import { defaultDisplay } from "@/lib/task-query/display";
import type { FilterNode } from "@/lib/task-query/model";
import type { ProjectWithTasks } from "@/types/project";

// Calendar and Gantt filter by custom fields the way Board and List do: the
// project filter bar offers each field, and the engine's ids (from the same
// filter tree) narrow the loaded tasks the two views draw.

const m = vi.hoisted(() => ({
  requests: [] as Record<string, unknown>[],
  toolbar: vi.fn(),
}));

vi.mock("@/fetchers/task-query/query-tasks", () => ({
  default: async (request: Record<string, unknown>) => {
    m.requests.push(request);
    return { ids: ["t2"], truncated: false, totalCount: 1 };
  },
}));
vi.mock("@/fetchers/custom-field/get-custom-fields-by-project", () => ({
  default: async () => [
    {
      id: "f1",
      name: "Customer",
      type: "dropdown",
      options: ["Acme", "Globex"],
    },
  ],
}));
vi.mock("@/fetchers/custom-field/get-custom-field-filter-values", () => ({
  default: async () => [],
}));
vi.mock("@/components/task-filters/task-toolbar", () => ({
  default: (props: Record<string, unknown>) => {
    m.toolbar(props);
    return null;
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const CUSTOMER_IS_ACME: FilterNode = {
  op: "and",
  children: [
    {
      key: "customField",
      fieldId: "f1",
      operator: "in",
      values: ["Acme"],
    },
  ],
};

function task(id: string) {
  return { id, title: id, number: 1, status: "to-do" };
}

const project = {
  id: "p1",
  slug: "PROJ",
  columns: [{ id: "c1", slug: "to-do", tasks: [task("t1"), task("t2")] }],
  plannedTasks: [task("t3")],
} as unknown as ProjectWithTasks;

beforeEach(() => {
  m.requests = [];
  m.toolbar.mockClear();
});
afterEach(cleanup);

describe("custom field filters on Calendar and Gantt", () => {
  it("offers each custom field in the project filter bar's Filter menu", async () => {
    render(
      <ProjectFilterBar
        workspaceId="w1"
        projectId="p1"
        // biome-ignore lint/suspicious/noExplicitAny: only passed through.
        handle={{} as any}
      />,
    );
    const props = m.toolbar.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(props.scope).toEqual({ kind: "project", projectId: "p1" });
    expect(props.hiddenSubjects).toBeUndefined();

    const { result } = renderHook(
      () =>
        useFilterSubjects({
          workspaceId: "w1",
          scope: { kind: "project", projectId: "p1" },
          projects: [{ id: "p1", name: "Project", slug: "PROJ" }],
          isActive: () => true,
        }),
      { wrapper },
    );
    await waitFor(() =>
      expect(
        result.current.find((subject) => subject.id === "customField:f1"),
      ).toBeDefined(),
    );
    const subject = result.current.find(
      (entry) => entry.id === "customField:f1",
    );
    expect(subject).toMatchObject({
      key: "customField",
      fieldId: "f1",
      label: "Customer",
    });
    expect(subject?.options.map((option) => option.value)).toEqual([
      "none",
      "Acme",
      "Globex",
    ]);
  });

  it("narrows the loaded tasks to the engine's matches for the field", async () => {
    const { result } = renderHook(
      () =>
        useClassicBoardFilter({
          workspaceId: "w1",
          projectId: "p1",
          state: {
            filters: CUSTOMER_IS_ACME,
            archived: "exclude",
            display: defaultDisplay("project"),
          },
          project,
        }),
      { wrapper },
    );

    await waitFor(() =>
      expect(
        result.current.filteredProject?.columns[0]?.tasks.map(
          (entry) => entry.id,
        ),
      ).toEqual(["t2"]),
    );
    expect(result.current.filteredProject?.plannedTasks).toEqual([]);
    expect(m.requests).toHaveLength(1);
    expect(m.requests[0]).toMatchObject({
      workspaceId: "w1",
      scope: { projectIds: ["p1"] },
      mode: "ids",
      filters: CUSTOMER_IS_ACME,
    });
  });
});
