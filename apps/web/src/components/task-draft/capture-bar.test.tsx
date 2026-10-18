import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CaptureBar from "./capture-bar";
import { focusCapture } from "./capture-store";

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  createLabel: vi.fn(),
  canCreateLabels: true,
  composer: vi.fn(),
  runSlots: vi.fn(),
  defaultAssigneeUserId: null as string | null,
  templates: [] as Array<Record<string, unknown>>,
  applyTemplate: vi.fn(),
}));

vi.mock("@/hooks/queries/task-template/use-task-templates", () => ({
  useTaskTemplates: () => ({ data: mocks.templates }),
}));
vi.mock("@/hooks/mutations/task-template/use-apply-task-template", () => ({
  useApplyTaskTemplate: () => ({
    mutateAsync: mocks.applyTemplate,
    isPending: false,
  }),
}));

vi.mock("@/lib/task-property-slots", () => ({
  runCreateModalSlots: mocks.runSlots,
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/hooks/mutations/task/use-create-task", () => ({
  default: () => ({ mutateAsync: mocks.createTask }),
}));
vi.mock("@/hooks/mutations/label/use-create-label", () => ({
  default: () => ({ mutateAsync: mocks.createLabel }),
}));
vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: () => ({
    data: [
      { id: "l1", name: "Bug", color: "red" },
      { id: "l2", name: "bug", color: "red" },
    ],
  }),
}));
vi.mock("@/hooks/use-task-assignees", () => ({
  useAssigneePeople: () => ({
    people: [
      { id: "u-ana", name: "Ana Lima", image: null },
      { id: "u-ravi", name: "Ravi Iyer", image: null },
    ],
  }),
}));
vi.mock("@/hooks/queries/project/use-project-people", () => ({
  default: () => ({ defaultAssigneeUserId: mocks.defaultAssigneeUserId }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateLabels: () => mocks.canCreateLabels,
    canUpdateTasks: () => true,
  }),
}));
vi.mock("@/components/shared/modals/create-task-modal", () => ({
  default: (props: unknown) => {
    mocks.composer(props);
    return <div data-testid="composer" />;
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.canCreateLabels = true;
  mocks.defaultAssigneeUserId = null;
  mocks.templates = [];
});

function renderBar() {
  render(
    <CaptureBar
      projectId="p1"
      workspaceId="w1"
      status="in-progress"
      statusName="In Progress"
    />,
  );
  return screen.getByRole("textbox");
}

describe("CaptureBar", () => {
  it("shows the parsed tokens as chips and creates the task on Enter", async () => {
    mocks.createTask.mockResolvedValue({ id: "t1" });
    mocks.createLabel.mockResolvedValue({});
    const input = renderBar();

    fireEvent.change(input, {
      target: { value: "Fix 404 @ana #bug #perf !high tomorrow" },
    });
    const chips = document.querySelectorAll("[data-token]");
    expect([...chips].map((chip) => chip.getAttribute("data-token"))).toEqual([
      "assignee",
      "label",
      "label",
      "priority",
      "due",
    ]);
    expect(screen.getByText("Ana Lima")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter" });
    expect((input as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(mocks.createLabel).toHaveBeenCalledTimes(2));

    const request = mocks.createTask.mock.calls[0][0];
    expect(request).toMatchObject({
      title: "Fix 404",
      description: "",
      projectId: "p1",
      status: "in-progress",
      assigneeIds: ["u-ana"],
      priority: "high",
    });
    const due = new Date(request.dueDate);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([
      tomorrow.getFullYear(),
      tomorrow.getMonth(),
      tomorrow.getDate(),
    ]);
    expect(mocks.createLabel).toHaveBeenCalledWith({
      name: "Bug",
      color: "red",
      taskId: "t1",
      workspaceId: "w1",
    });
    expect(mocks.createLabel).toHaveBeenCalledWith({
      name: "perf",
      color: "gray",
      taskId: "t1",
      workspaceId: "w1",
    });
  });

  it("keeps a removed chip's text in the title", async () => {
    mocks.createTask.mockResolvedValue({ id: "t1" });
    const input = renderBar();
    fireEvent.change(input, { target: { value: "Ship #bug fix" } });
    fireEvent.click(
      screen.getByRole("button", { name: /tasks:capture.removeToken/ }),
    );
    expect(document.querySelectorAll("[data-token]")).toHaveLength(0);

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalled());
    expect(mocks.createTask.mock.calls[0][0].title).toBe("Ship #bug fix");
    expect(mocks.createLabel).not.toHaveBeenCalled();
  });

  it("does not create a task without a title", () => {
    const input = renderBar();
    fireEvent.change(input, { target: { value: "@ana !high" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("does not offer new labels without permission", () => {
    mocks.canCreateLabels = false;
    const input = renderBar();
    fireEvent.change(input, { target: { value: "x #perf" } });
    expect(document.querySelectorAll("[data-token]")).toHaveLength(0);
  });

  it("gives the text back when creating fails", async () => {
    mocks.createTask.mockRejectedValue(new Error("nope"));
    const input = renderBar();
    fireEvent.change(input, { target: { value: "Broken @ana" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect((input as HTMLInputElement).value).toBe("Broken @ana"),
    );
  });

  it("opens the full composer with the parsed values on Ctrl Enter", () => {
    const input = renderBar();
    fireEvent.change(input, { target: { value: "Plan @ravi !low 12 Oct" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(screen.getByTestId("composer")).toBeTruthy();
    const props = mocks.composer.mock.calls.at(-1)?.[0];
    expect(props).toMatchObject({
      projectId: "p1",
      status: "in-progress",
      prefill: { title: "Plan", priority: "low", assigneeIds: ["u-ravi"] },
    });
    expect(props.prefill.dueDate.getDate()).toBe(12);
    expect(props.prefill.dueDate.getMonth()).toBe(9);
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("prefills the project's default assignee as a removable chip", async () => {
    mocks.defaultAssigneeUserId = "u-ravi";
    mocks.createTask.mockResolvedValue({ id: "t1" });
    const input = renderBar();
    fireEvent.change(input, { target: { value: "Write docs" } });
    expect(
      document.querySelector('[data-token="default-assignee"]'),
    ).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    expect(mocks.createTask.mock.calls[0][0].assigneeIds).toEqual(["u-ravi"]);
  });

  it("creates unassigned once the default chip is removed", async () => {
    mocks.defaultAssigneeUserId = "u-ravi";
    mocks.createTask.mockResolvedValue({ id: "t1" });
    const input = renderBar();
    fireEvent.change(input, { target: { value: "Write docs" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: /tasks:capture.removeDefaultAssignee/,
      }),
    );
    expect(document.querySelector('[data-token="default-assignee"]')).toBe(
      null,
    );

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    expect(mocks.createTask.mock.calls[0][0].assigneeIds).toEqual([]);
  });

  it("lets a typed @person replace the default", async () => {
    mocks.defaultAssigneeUserId = "u-ravi";
    mocks.createTask.mockResolvedValue({ id: "t1" });
    const input = renderBar();
    fireEvent.change(input, { target: { value: "Review @ana" } });
    expect(document.querySelector('[data-token="default-assignee"]')).toBe(
      null,
    );
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    expect(mocks.createTask.mock.calls[0][0].assigneeIds).toEqual(["u-ana"]);
  });

  it("creates with a group's values and reports the new task", async () => {
    mocks.defaultAssigneeUserId = "u-ravi";
    mocks.createTask.mockResolvedValue({ id: "t9" });
    mocks.createLabel.mockResolvedValue({});
    mocks.runSlots.mockResolvedValue([]);
    const onCreated = vi.fn();
    render(
      <CaptureBar
        projectId="p1"
        workspaceId="w1"
        prefill={{
          status: "to-do",
          targetName: "High",
          priority: "high",
          assigneeIds: ["u-ana"],
          labels: [{ name: "Bug", color: "red" }],
          cycleId: "c1",
          moduleId: "m1",
        }}
        onCreated={onCreated}
      />,
    );
    const input = screen.getByRole("textbox", {
      name: 'tasks:capture.ariaLabel {"column":"High"}',
    });
    // The group's assignee replaces the project default.
    fireEvent.change(input, { target: { value: "Fix it #bug" } });
    expect(document.querySelector('[data-token="default-assignee"]')).toBe(
      null,
    );
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));

    expect(mocks.createTask.mock.calls[0][0]).toMatchObject({
      title: "Fix it",
      projectId: "p1",
      status: "to-do",
      priority: "high",
      assigneeIds: ["u-ana"],
    });
    expect(mocks.runSlots).toHaveBeenCalledWith({
      task: { id: "t9", projectId: "p1" },
      values: { cycle: "c1", module: ["m1"] },
    });
    // "#bug" and the group's Bug are one label.
    expect(mocks.createLabel).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith({ id: "t9", projectId: "p1" });
  });

  it("lets typed tokens win over the group's priority and due date", async () => {
    mocks.createTask.mockResolvedValue({ id: "t1" });
    render(
      <CaptureBar
        projectId="p1"
        workspaceId="w1"
        prefill={{
          status: "to-do",
          targetName: "To do",
          priority: "low",
          dueDate: "2026-10-21",
        }}
      />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Ship !urgent" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    const request = mocks.createTask.mock.calls[0][0];
    expect(request.priority).toBe("urgent");
    const due = new Date(request.dueDate);
    expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([
      2026, 9, 21,
    ]);
    expect(mocks.runSlots).not.toHaveBeenCalled();
  });

  it("hands Ctrl Enter to the host and names the input after it", () => {
    const onOpenComposer = vi.fn();
    render(
      <CaptureBar
        projectId="p1"
        workspaceId="w1"
        prefill={{
          status: "to-do",
          targetName: "To do",
          dueDate: "2026-10-21",
        }}
        inputLabel="Add task due Wednesday"
        onOpenComposer={onOpenComposer}
      />,
    );
    const input = screen.getByRole("textbox", {
      name: "Add task due Wednesday",
    });
    fireEvent.change(input, { target: { value: "Plan" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(screen.queryByTestId("composer")).toBe(null);
    const handoff = onOpenComposer.mock.calls[0][0];
    expect(handoff.status).toBe("to-do");
    expect(handoff.prefill.title).toBe("Plan");
    expect(handoff.prefill.dueDate.getDate()).toBe(21);
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("leaves column focus requests to the column bars", () => {
    render(
      <CaptureBar
        projectId="p1"
        workspaceId="w1"
        prefill={{ status: "in-progress", targetName: "High" }}
      />,
    );
    const input = screen.getByRole("textbox");
    act(() => focusCapture("p1", "in-progress"));
    expect(document.activeElement).not.toBe(input);
  });

  it("clears on the first Escape and focuses on a matching request", () => {
    const input = renderBar();
    fireEvent.change(input, { target: { value: "draft" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("");

    act(() => focusCapture("p1", "other-column"));
    expect(document.activeElement).not.toBe(input);
    act(() => focusCapture("p1", "in-progress"));
    expect(document.activeElement).toBe(input);
  });

  it("offers templates only when the project has some", async () => {
    const input = renderBar();
    fireEvent.change(input, { target: { value: "crash" } });
    expect(
      screen.queryByRole("button", { name: "templates:use.quickAdd" }),
    ).toBeNull();
    cleanup();

    mocks.templates = [
      { id: "tpl1", name: "Bug report", titlePattern: "Bug:", subtasks: [] },
    ];
    mocks.applyTemplate.mockResolvedValue({ id: "t9", subtaskIds: [] });
    const next = renderBar();
    fireEvent.change(next, { target: { value: "crash @ana" } });
    fireEvent.click(
      screen.getByRole("button", { name: "templates:use.quickAdd" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Bug report/ }),
    );
    await waitFor(() =>
      expect(mocks.applyTemplate).toHaveBeenCalledWith({
        templateId: "tpl1",
        projectId: "p1",
        workspaceId: "w1",
        input: { title: "crash", status: "in-progress" },
      }),
    );
    await waitFor(() => expect((next as HTMLInputElement).value).toBe(""));
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
});
