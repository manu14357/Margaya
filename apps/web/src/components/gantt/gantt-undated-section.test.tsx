import { DndContext } from "@dnd-kit/core";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import GanttUndatedSection from "./gantt-undated-section";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.title ? `${key}:${options.title}` : key,
  }),
}));
vi.mock("@/lib/i18n/domain", () => ({
  getStatusLabel: (status: string) => status,
  getPriorityLabel: (priority: string) => priority,
}));

afterEach(cleanup);

const TITLE = "Outline the onboarding emails for new workspaces";
const task = {
  id: "t1",
  title: TITLE,
  number: 3,
  status: "to-do",
  priority: "medium",
} as Task;

function show(props: Partial<ComponentProps<typeof GanttUndatedSection>>) {
  return render(
    <DndContext>
      <GanttUndatedSection
        tasks={[task]}
        projectSlug="WEB"
        railWidth="12rem"
        timelineMinWidthRem={150}
        canEdit
        onOpenTask={vi.fn()}
        onSchedule={vi.fn()}
        {...props}
      />
    </DndContext>,
  );
}

/** The sticky cell that holds a row's card, beside the timeline. */
const cellOf = (title: HTMLElement) =>
  title.closest<HTMLElement>("[data-gantt-undated] > div");

describe("the undated list", () => {
  it("uses the chart's whole width on a phone, with titles on up to two lines", () => {
    show({ wide: true });
    const title = screen.getByText(TITLE);

    // The task list column is 12rem on a phone, which left a title two or
    // three letters; the list takes the visible width instead.
    expect(cellOf(title)?.style.width).toBe("100cqw");
    expect(title).toHaveClass("line-clamp-2");
    expect(title).not.toHaveClass("truncate");
    expect(
      screen.getByRole("button", { name: `tasks:gantt.scheduleTask:${TITLE}` }),
    ).toBeInTheDocument();
  });

  it("stays in the task list column on wider screens", () => {
    show({ railWidth: "20rem" });
    const title = screen.getByText(TITLE);
    expect(cellOf(title)?.style.width).toBe("20rem");
    expect(title).toHaveClass("truncate");
  });
});
