import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { Flag } from "lucide-react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FilterChip from "./filter-chip";
import FilterMenu from "./filter-menu";
import { type FilterSubject, useFilterSubjects } from "./subjects";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.count !== undefined ? `${key}:${options.count}` : key,
  }),
}));

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "me-id" } }),
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const prioritySubject: FilterSubject = {
  id: "priority",
  key: "priority",
  label: "Priority",
  icon: Flag,
  kind: "set",
  options: [
    { value: "high", label: "High" },
    { value: "low", label: "Low" },
  ],
};

function openMenu(props: Partial<Parameters<typeof FilterMenu>[0]> = {}) {
  const onFiltersChange = vi.fn();
  const onArchivedChange = vi.fn();
  render(
    <FilterMenu
      subjects={[prioritySubject]}
      filters={null}
      onFiltersChange={onFiltersChange}
      archived="exclude"
      onArchivedChange={onArchivedChange}
      hasActiveFilters={false}
      onClear={vi.fn()}
      onEditDate={vi.fn()}
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /tasks:filters.button/ }));
  return { onFiltersChange, onArchivedChange };
}

describe("FilterMenu", () => {
  it("adds a condition when a value is picked", async () => {
    const { onFiltersChange } = openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Priority/ }));
    fireEvent.click(await screen.findByRole("button", { name: /High/ }));
    expect(onFiltersChange).toHaveBeenCalledWith({
      op: "and",
      children: [{ key: "priority", operator: "in", values: ["high"] }],
    });
  });

  it("sets the archived filter", async () => {
    const { onArchivedChange } = openMenu();
    fireEvent.click(
      await screen.findByRole("menuitemradio", {
        name: "tasks:filters.archived.only",
      }),
    );
    expect(onArchivedChange).toHaveBeenCalledWith("only");
  });

  it("hides the archived radio where archived tasks have their own list", async () => {
    openMenu({ onArchivedChange: undefined });
    await screen.findByRole("menuitem", { name: /Priority/ });
    expect(
      screen.queryByRole("menuitemradio", {
        name: "tasks:filters.archived.only",
      }),
    ).toBeNull();
  });
});

describe("FilterChip", () => {
  it("cycles a set condition between is any of and is none of", () => {
    const onChange = vi.fn();
    render(
      <FilterChip
        subject={prioritySubject}
        condition={{ key: "priority", operator: "in", values: ["high", "low"] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:boardFilters.operators.isAnyOf",
      }),
    );
    expect(onChange).toHaveBeenCalledWith({
      key: "priority",
      operator: "notIn",
      values: ["high", "low"],
    });
    fireEvent.click(
      screen.getByRole("button", { name: /tasks:filters.removeFilter/ }),
    );
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("filter subjects", () => {
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={new QueryClient()}>
        {children}
      </QueryClientProvider>
    );
  }

  const subjectsFor = (cyclesEnabled: boolean) =>
    renderHook(
      () =>
        useFilterSubjects({
          workspaceId: "w1",
          scope: { kind: "project", projectId: "p1" },
          projects: [{ id: "p1", name: "Web", slug: "WEB", cyclesEnabled }],
          isActive: () => false,
        }),
      { wrapper },
    ).result.current.map((subject) => subject.key);

  it("hides feature subjects when no project in scope has the feature", () => {
    expect(subjectsFor(false)).not.toContain("cycle");
    expect(subjectsFor(true)).toContain("cycle");
  });

  it("offers status only for one project, project only for the workspace", () => {
    const keys = subjectsFor(false);
    expect(keys).toContain("status");
    expect(keys).not.toContain("project");
    const workspace = renderHook(
      () =>
        useFilterSubjects({
          workspaceId: "w1",
          scope: { kind: "workspace" },
          projects: [],
          isActive: () => false,
        }),
      { wrapper },
    ).result.current.map((subject) => subject.key);
    expect(workspace).not.toContain("status");
    expect(workspace).toContain("project");
    expect(workspace).toEqual(
      expect.arrayContaining([
        "group",
        "priority",
        "assignee",
        "createdBy",
        "label",
        "startDate",
        "dueDate",
        "createdAt",
        "updatedAt",
        "completedAt",
        "parent",
        "subscriber",
        "mention",
      ]),
    );
  });
});
