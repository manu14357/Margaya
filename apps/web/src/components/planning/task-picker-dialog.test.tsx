import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskCandidate } from "@/lib/planning/candidates";
import type Task from "@/types/task";
import TaskPickerDialog from "./task-picker-dialog";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key} ${options.count}`,
  }),
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function candidate(id: string, number: number, title: string): TaskCandidate {
  const task: Task = {
    id,
    title,
    number,
    description: null,
    status: "to-do",
    priority: null,
    startDate: null,
    dueDate: null,
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "p1",
  };
  return {
    task,
    key: `WEB-${number}`,
    column: { slug: "to-do", icon: null, group: "unstarted" },
  };
}

const candidates = [
  candidate("a", 1, "Write the docs"),
  candidate("b", 2, "Fix the login"),
  candidate("c", 3, "Ship it"),
];

function renderPicker(offered: readonly TaskCandidate[] = candidates) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn();
  render(
    <TaskPickerDialog
      open
      onOpenChange={onOpenChange}
      candidates={offered}
      emptyText="nothing to add"
      noResultsText="no match"
      isPending={false}
      onSubmit={onSubmit}
    />,
  );
  return { onOpenChange, onSubmit };
}

describe("TaskPickerDialog", () => {
  it("searches the candidates by key or title", async () => {
    renderPicker();
    expect(await screen.findByText("Write the docs")).toBeInTheDocument();
    fireEvent.change(
      screen.getByLabelText("planning:addExisting.searchPlaceholder"),
      { target: { value: "web-2" } },
    );
    expect(screen.getByText("Fix the login")).toBeInTheDocument();
    expect(screen.queryByText("Write the docs")).toBeNull();

    fireEvent.change(
      screen.getByLabelText("planning:addExisting.searchPlaceholder"),
      { target: { value: "zzz" } },
    );
    expect(screen.getByText("no match")).toBeInTheDocument();
  });

  it("adds the picked tasks, then closes once the caller is done", async () => {
    const props = renderPicker();
    const submit = await screen.findByRole("button", {
      name: "planning:addExisting.submit 0",
    });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByText("Write the docs"));
    fireEvent.click(screen.getByText("Ship it"));
    fireEvent.click(
      screen.getByRole("button", { name: "planning:addExisting.submit 2" }),
    );

    expect(props.onSubmit).toHaveBeenCalledWith(
      ["a", "c"],
      expect.any(Function),
    );
    expect(props.onOpenChange).not.toHaveBeenCalled();
    const done = props.onSubmit.mock.calls[0]?.[1] as () => void;
    done();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says when there is nothing to add", async () => {
    renderPicker([]);
    expect(await screen.findByText("nothing to add")).toBeInTheDocument();
  });
});
