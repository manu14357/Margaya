import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectGantt from "./project-gantt";

const m = vi.hoisted(() => ({
  updateDates: vi.fn(),
  createRelation: vi.fn(),
  deleteRelation: vi.fn(),
  applyCascade: vi.fn(),
  relations: [] as Record<string, unknown>[],
  blockedTaskIds: [] as string[],
  canUpdate: true,
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
  picker: vi.fn(),
  linkAnchor: undefined as unknown,
}));

vi.mock("@/hooks/mutations/task/use-update-task-dates", () => ({
  useUpdateTaskDates: () => ({
    mutate: m.updateDates,
    mutateAsync: m.updateDates,
  }),
}));
vi.mock("@/hooks/mutations/task-relation/use-create-task-relation", () => ({
  default: () => ({ mutateAsync: m.createRelation }),
}));
vi.mock("@/hooks/mutations/task-relation/use-delete-task-relation", () => ({
  default: () => ({ mutateAsync: m.deleteRelation }),
}));
vi.mock("@/hooks/mutations/task/use-apply-date-cascade", () => ({
  useApplyDateCascade: () => ({
    mutateAsync: m.applyCascade,
    isPending: false,
  }),
}));
// The project has no custom fields, so the Gantt offers no field choice.
vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-fields-by-project",
  () => ({
    default: () => ({ data: [] }),
  }),
);
vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-field-values-by-project",
  () => ({ default: () => ({ data: undefined }) }),
);
vi.mock("@/hooks/queries/task-relation/use-get-project-dependencies", () => ({
  useGetProjectDependencies: () => ({
    data: { relations: m.relations, blockedTaskIds: m.blockedTaskIds },
  }),
}));
vi.mock("@/components/gantt/gantt-link-picker", () => ({
  default: ({ taskId }: { taskId: string }) => {
    m.picker(taskId);
    return <div data-testid="link-picker">{taskId}</div>;
  },
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => m.canUpdate,
    canCreateTasks: () => false,
  }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    selector: (state: {
      weekStartsOn: number;
      showAssignees: boolean;
    }) => unknown,
  ) => selector({ weekStartsOn: 1, showAssignees: false }),
}));
vi.mock("@/lib/i18n/domain", () => ({
  getStatusLabel: (status: string) => status,
  getPriorityLabel: (priority: string) => priority,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.title ? `${key}:${options.title}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/lib/toast", () => ({ toast: m.toast }));
vi.mock("@/components/task-draft/quick-add", () => ({ default: () => null }));
// The real popover, recording what the link popover is anchored to.
vi.mock("@/components/ui/popover", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/popover")>();
  return {
    ...actual,
    PopoverContent: (props: Parameters<typeof actual.PopoverContent>[0]) => {
      if (
        (props as Record<string, unknown>)["data-testid"] ===
        "gantt-link-popover"
      )
        m.linkAnchor = props.anchor;
      return <actual.PopoverContent {...props} />;
    },
  };
});

/** Where the link popover points now, in the viewport. */
function linkAnchorRect() {
  const anchor = m.linkAnchor as
    | { getBoundingClientRect: () => DOMRect }
    | undefined;
  return anchor?.getBoundingClientRect();
}

type TestTask = Record<string, unknown> & { id: string };

function task(id: string, startDate: string | null, dueDate: string | null) {
  return {
    id,
    projectId: "project",
    title: id,
    number: 1,
    status: "to-do",
    startDate,
    dueDate,
    description: "",
    labels: [],
    priority: "low",
    position: 1,
  } as TestTask;
}

function show(tasks: TestTask[]) {
  const project = {
    id: "project",
    name: "Project",
    slug: "PROJ",
    columns: [{ id: "to-do", slug: "to-do", tasks, group: "unstarted" }],
    plannedTasks: [],
  };
  return render(
    <ProjectGantt
      workspaceId="workspace"
      projectId="project"
      // biome-ignore lint/suspicious/noExplicitAny: a hand-built board.
      loadedProject={project as any}
      // biome-ignore lint/suspicious/noExplicitAny: a hand-built board.
      project={project as any}
      isLoading={false}
      loadFailure={null}
      onOpenTask={vi.fn()}
    />,
  );
}

const rowOf = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(
    `[data-gantt-row="${id}"]`,
  ) as HTMLElement;

/** Draws from a task's handle to whatever `over` is under the pointer. */
function drag(handle: HTMLElement, ...over: Element[]) {
  document.elementsFromPoint = vi.fn(() => over);
  fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: 200, clientY: 80 });
}

const A = task("a", "2026-10-01", "2026-10-10");
const B = task("b", "2026-10-05", "2026-10-08");
const handleOf = (id: string) =>
  screen.getByRole("button", { name: `tasks:gantt.linkFrom:${id}` });

beforeEach(() => {
  vi.clearAllMocks();
  m.relations = [];
  m.blockedTaskIds = [];
  m.canUpdate = true;
  m.linkAnchor = undefined;
  m.createRelation.mockResolvedValue({ id: "new" });
  m.deleteRelation.mockResolvedValue(undefined);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  // jsdom has no scrollTo; the chart centres on today with it.
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("PointerEvent", MouseEvent);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("drawing links on the Gantt", () => {
  it("draws a blocks relation from one bar's handle to another's row", async () => {
    const { container } = show([A, B]);
    const target = rowOf(container, "b");

    drag(handleOf("a"), target);
    expect(target.hasAttribute("data-gantt-link-target")).toBe(true);
    expect(
      container.querySelector("[data-testid=gantt-link-preview] path"),
    ).toHaveAttribute("d");

    fireEvent.pointerUp(window);
    expect(target.hasAttribute("data-gantt-link-target")).toBe(false);
    expect(m.createRelation).toHaveBeenCalledWith({
      sourceTaskId: "a",
      targetTaskId: "b",
      relationType: "blocks",
    });
    await waitFor(() => expect(m.toast.success).toHaveBeenCalled());
    // The link leaves b behind a; it is only offered, nothing has moved.
    expect(m.toast.warning).toHaveBeenCalledOnce();
    expect(m.applyCascade).not.toHaveBeenCalled();
    expect(m.updateDates).not.toHaveBeenCalled();
  });

  it("finds the row under another link's line", async () => {
    m.relations = [
      { id: "r", sourceTaskId: "c", targetTaskId: "b", relationType: "blocks" },
    ];
    const { container } = show([
      A,
      task("b", "2026-10-20", "2026-10-21"),
      task("c", "2026-10-02", "2026-10-03"),
    ]);
    const target = rowOf(container, "b");

    drag(handleOf("a"), screen.getByTestId("gantt-dependency-hit"), target);
    expect(target.hasAttribute("data-gantt-link-target")).toBe(true);

    fireEvent.pointerUp(window);
    expect(m.createRelation).toHaveBeenCalledWith({
      sourceTaskId: "a",
      targetTaskId: "b",
      relationType: "blocks",
    });
    await waitFor(() => expect(m.toast.success).toHaveBeenCalled());
  });

  it("does not link a task to itself or to empty space, and Escape cancels", () => {
    const { container } = show([A, B]);

    drag(handleOf("a"), rowOf(container, "a"));
    fireEvent.pointerUp(window);
    drag(handleOf("a"));
    fireEvent.pointerUp(window);
    drag(handleOf("a"), rowOf(container, "b"));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window);

    expect(m.createRelation).not.toHaveBeenCalled();
    expect(screen.queryByTestId("link-picker")).toBeNull();
  });

  it("opens the picker for a press without a drag, and from the keyboard", () => {
    show([A, B]);

    fireEvent.pointerDown(handleOf("b"), { button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(window);
    expect(screen.getByTestId("link-picker")).toHaveTextContent("b");
    expect(m.createRelation).not.toHaveBeenCalled();
  });

  it("opens the picker with Enter on the handle", () => {
    show([A, B]);
    fireEvent.keyDown(handleOf("a"), { key: "Enter" });
    expect(screen.getByTestId("link-picker")).toHaveTextContent("a");
  });

  it("explains why the API refused a link", async () => {
    const { HttpError } = await import("@/lib/http-error");
    m.createRelation.mockRejectedValue(
      new HttpError(400, "This would create a circular dependency"),
    );
    const { container } = show([A, B]);

    drag(handleOf("a"), rowOf(container, "b"));
    fireEvent.pointerUp(window);

    await waitFor(() =>
      expect(m.toast.error).toHaveBeenCalledWith(
        "This would create a circular dependency",
      ),
    );
    expect(m.toast.warning).not.toHaveBeenCalled();
  });

  it("offers no handle or clickable line to someone who can't edit", () => {
    m.canUpdate = false;
    m.relations = [
      { id: "r", sourceTaskId: "a", targetTaskId: "b", relationType: "blocks" },
    ];
    show([A, B]);
    expect(
      screen.queryByRole("button", { name: "tasks:gantt.linkFrom:a" }),
    ).toBeNull();
    expect(screen.queryByTestId("gantt-dependency-hit")).toBeNull();
  });
});

describe("a link on the chart", () => {
  beforeEach(() => {
    m.relations = [
      { id: "r", sourceTaskId: "a", targetTaskId: "b", relationType: "blocks" },
    ];
  });

  it("can be removed from its line", async () => {
    show([A, task("b", "2026-10-11", "2026-10-12")]);

    fireEvent.click(screen.getByTestId("gantt-dependency-hit"));
    const remove = await screen.findByRole("button", {
      name: "tasks:relations.removeRelation",
    });
    expect(screen.getByText("tasks:gantt.link.blocks")).toBeInTheDocument();
    expect(screen.queryByText("tasks:gantt.link.conflict")).toBeNull();

    fireEvent.click(remove);
    expect(m.deleteRelation).toHaveBeenCalledWith("r");
  });

  it("opens with its entrance instead of already open", () => {
    show([A, task("b", "2026-10-11", "2026-10-12")]);

    fireEvent.click(screen.getByTestId("gantt-dependency-hit"));

    // A popover rendered already open skips its starting style, so it shows
    // at once, unfaded, wherever it is before it is placed.
    expect(screen.getByTestId("gantt-link-popover")).toHaveAttribute(
      "data-starting-style",
    );
  });

  it("is placed under both linked bars at the clicked spot, and moves with the chart", async () => {
    const { container } = show([A, task("b", "2026-10-11", "2026-10-12")]);
    const box = (left: number, top: number, width: number, height: number) =>
      ({
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        toJSON: () => null,
      }) as DOMRect;
    // The chart's rows start at (100, 200): row a, then row b under it.
    let scrolled = 0;
    const rows = rowOf(container, "a").parentElement as HTMLElement;
    rows.getBoundingClientRect = () => box(100 - scrolled, 200, 2000, 80);
    rowOf(container, "a").getBoundingClientRect = () =>
      box(100 - scrolled, 200, 2000, 40);
    rowOf(container, "b").getBoundingClientRect = () =>
      box(100 - scrolled, 240, 2000, 40);

    fireEvent.click(screen.getByTestId("gantt-dependency-hit"), {
      clientX: 400,
      clientY: 238,
    });

    // Its anchor spans both rows, so the popover below (or flipped above)
    // covers neither bar.
    expect(linkAnchorRect()).toMatchObject({
      left: 400,
      top: 200,
      bottom: 280,
    });
    // Scrolled 50px along, the clicked spot has moved with the chart.
    scrolled = 50;
    expect(linkAnchorRect()).toMatchObject({
      left: 350,
      top: 200,
      bottom: 280,
    });
  });

  it("says so when its line can't be removed", async () => {
    m.deleteRelation.mockRejectedValue(new Error("offline"));
    show([A, task("b", "2026-10-11", "2026-10-12")]);

    fireEvent.click(screen.getByTestId("gantt-dependency-hit"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "tasks:relations.removeRelation",
      }),
    );

    await waitFor(() =>
      expect(m.toast.error).toHaveBeenCalledWith("tasks:relations.removeError"),
    );
  });

  it("previews the date changes and moves nothing until confirmed", async () => {
    m.applyCascade.mockResolvedValue({ moved: 1, failed: 0 });
    show([A, B]);

    fireEvent.click(screen.getByTestId("gantt-dependency-hit"));
    expect(
      await screen.findByText("tasks:gantt.link.conflict"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:gantt.cascade.reviewAction",
      }),
    );

    const preview = await screen.findByTestId("gantt-cascade-preview");
    expect(preview).toHaveTextContent("Oct 5 – Oct 8");
    expect(preview).toHaveTextContent("Oct 10 – Oct 13");
    expect(m.applyCascade).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:gantt.cascade.confirm" }),
    );
    await waitFor(() => expect(m.applyCascade).toHaveBeenCalledOnce());
    const [moves] = m.applyCascade.mock.calls[0] as [
      { task: { id: string }; startDate: string; dueDate: string }[],
    ];
    expect(moves.map((move) => move.task.id)).toEqual(["b"]);
    expect(new Date(moves[0]?.startDate ?? "").getDate()).toBe(10);
    expect(new Date(moves[0]?.dueDate ?? "").getDate()).toBe(13);
    await waitFor(() => expect(m.toast.success).toHaveBeenCalled());
  });

  it("keeps the dates when the preview is dismissed", async () => {
    show([A, B]);

    fireEvent.click(screen.getByTestId("gantt-dependency-hit"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "tasks:gantt.cascade.reviewAction",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "tasks:gantt.cascade.cancel" }),
    );

    await waitFor(() =>
      expect(screen.queryByTestId("gantt-cascade-preview")).toBeNull(),
    );
    expect(m.applyCascade).not.toHaveBeenCalled();
    expect(m.updateDates).not.toHaveBeenCalled();
  });

  it("offers the same preview after a drag leaves a dependent behind", async () => {
    m.relations = [
      { id: "r", sourceTaskId: "a", targetTaskId: "b", relationType: "blocks" },
    ];
    m.updateDates.mockResolvedValue(undefined);
    const fits = task("b", "2026-10-11", "2026-10-12");
    show([A, fits]);

    // Every day column is 0px wide in jsdom, so any drag lands on the bar's
    // own clamped last day; the offer only needs a saved move that overruns.
    const bar = screen.getByRole("button", {
      name: "tasks:gantt.taskAriaLabel:a",
    });
    fireEvent.pointerDown(bar, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 0 });

    await waitFor(() => expect(m.updateDates).toHaveBeenCalled());
    await waitFor(() => expect(m.toast.warning).toHaveBeenCalledOnce());
    const [, options] = m.toast.warning.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];
    expect(m.applyCascade).not.toHaveBeenCalled();
    expect(options.action.onClick).toBeTypeOf("function");
  });
});

describe("the month row", () => {
  it("hides a month's name rather than show a piece of it at the task list's edge", async () => {
    // September's band shows 20px beside the 320px task list; October's is
    // wide open.
    let septemberRight = 340;
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const text = this.textContent ?? "";
        const [left, right] = this.hasAttribute("data-gantt-month-band")
          ? text.startsWith("September")
            ? [300, septemberRight]
            : [septemberRight, 2000]
          : [0, 0];
        return {
          x: left,
          y: 0,
          left,
          right,
          top: 0,
          bottom: 0,
          width: right - left,
          height: 0,
          toJSON: () => null,
        } as DOMRect;
      });
    const width = vi
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute("data-gantt-month-label") ? 90 : 0;
      });
    try {
      show([A, B]);
      const label = (month: string) =>
        screen.getByText(new RegExp(`^${month} 2026$`));
      expect(label("September")).toHaveStyle({ visibility: "hidden" });
      expect(label("October")).not.toHaveStyle({ visibility: "hidden" });

      // Scrolled back, September has room again.
      septemberRight = 800;
      fireEvent.scroll(screen.getByTestId("gantt-scroll-container"));
      await waitFor(() =>
        expect(label("September")).not.toHaveStyle({ visibility: "hidden" }),
      );
    } finally {
      rect.mockRestore();
      width.mockRestore();
    }
  });
});

describe("milestones and blocking on the Gantt", () => {
  it("draws a milestone as a point on its due date, without resize handles", () => {
    const { container } = show([
      {
        ...task("beta", "2026-09-01", "2026-10-05"),
        isMilestone: true,
      },
    ]);
    expect(container.querySelector("[data-milestone]")).not.toBeNull();
    expect(
      screen.getByRole("button", {
        name: "tasks:gantt.milestone.ariaLabel:beta",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "tasks:gantt.resizeStart" }),
    ).toBeNull();
  });

  it("schedules an undated milestone on one day, not the default span", () => {
    show([{ ...task("beta", null, null), isMilestone: true }]);
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:gantt.scheduleTask:beta" }),
    );
    const [variables] = m.updateDates.mock.calls[0] as [
      { startDate: string; dueDate: string },
    ];
    expect(variables.startDate).toBe(variables.dueDate);
  });

  it("flags a blocked task in the task list, and only that one", () => {
    m.blockedTaskIds = ["b"];
    const { container } = show([A, B]);
    expect(
      rowOf(container, "b").querySelector('[aria-label="tasks:gantt.blocked"]'),
    ).not.toBeNull();
    expect(
      rowOf(container, "a").querySelector('[aria-label="tasks:gantt.blocked"]'),
    ).toBeNull();
  });

  it("never disables a blocked task's status or dates", () => {
    m.blockedTaskIds = ["b"];
    show([A, B]);
    const bar = screen.getByRole("button", {
      name: "tasks:gantt.taskAriaLabel:b",
    });
    expect(bar).toBeEnabled();
    act(() => {
      fireEvent.pointerDown(bar, { button: 0, clientX: 0, clientY: 0 });
      fireEvent.pointerUp(window, { clientX: 0, clientY: 0 });
    });
    expect(m.toast.error).not.toHaveBeenCalled();
  });
});
