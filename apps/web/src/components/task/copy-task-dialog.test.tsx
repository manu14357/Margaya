import enUS from "@i18n/en-US.json";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CopySourceData } from "@/lib/copy-task-options";
import CopyTaskDialog from "./copy-task-dialog";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  mutate: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  sourceHas: {} as Record<string, boolean>,
  parentTaskId: null as string | null,
}));

// Resolves against the real en-US bundle, so a missing key shows up as the
// raw key in the assertions.
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const [namespace, path] = key.split(":");
      const source = path
        .split(".")
        .reduce<unknown>(
          (accumulator, part) =>
            (accumulator as Record<string, unknown> | undefined)?.[part],
          (enUS as Record<string, unknown>)[namespace],
        );
      if (typeof source !== "string") return key;
      return source.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? `{{${name}}}`),
      );
    },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    isLoading: false,
    data: [
      { id: "p-ops", name: "Ops" },
      { id: "p-web", name: "Web" },
    ],
  }),
}));
vi.mock("@/hooks/mutations/task-copy/use-copy-task", () => ({
  default: () => ({ mutate: mocks.mutate, isPending: false }),
}));
vi.mock("./use-copy-source", () => ({
  useCopySource: () => ({
    task: { id: "task-1", title: "Login page", number: 12 },
    project: { id: "p-web", slug: "web", name: "Web" },
    sourceProjectId: "p-web",
    parentTaskId: mocks.parentTaskId,
    sourceHas: mocks.sourceHas,
    ready: true,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));

const everything: CopySourceData = {
  description: true,
  assignees: true,
  labels: true,
  dates: true,
  customFields: true,
  parent: true,
  planning: true,
  links: true,
  attachments: true,
};

function renderDialog() {
  render(
    <CopyTaskDialog
      target={{ taskId: "task-1", projectId: "p-web", workspaceId: "ws-1" }}
      open
      onOpenChange={vi.fn()}
    />,
  );
}

function checkbox(name: string) {
  return screen.queryByRole("checkbox", { name });
}

beforeEach(() => {
  mocks.sourceHas = { ...everything };
  mocks.parentTaskId = "parent-1";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CopyTaskDialog", () => {
  it("prefills the title and names the task being copied", async () => {
    renderDialog();
    expect(await screen.findByText("Make a copy of WEB-12")).toBeVisible();
    expect(screen.getByLabelText("Title")).toHaveValue("Login page (copy)");
    expect(
      screen.getByText("Status and priority are always copied."),
    ).toBeVisible();
  });

  it("lists only options the task has something for, links and files off", async () => {
    mocks.sourceHas = { ...everything, labels: false, attachments: false };
    renderDialog();
    await screen.findByText("Make a copy of WEB-12");

    expect(checkbox("Labels")).toBeNull();
    expect(checkbox("Attachments")).toBeNull();
    expect(checkbox("Description")).toBeChecked();
    expect(checkbox("Links")).not.toBeChecked();
  });

  it("drops same-project options and explains it for another project", async () => {
    renderDialog();
    await screen.findByText("Make a copy of WEB-12");
    expect(checkbox("Parent")).not.toBeNull();

    fireEvent.click(screen.getByRole("combobox", { name: "Project" }));
    const ops = await screen.findByRole("option", { name: "Ops" });
    fireEvent.pointerDown(ops, { pointerType: "mouse" });
    fireEvent.click(ops);

    await waitFor(() => expect(checkbox("Parent")).toBeNull());
    expect(checkbox("Custom field values")).toBeNull();
    expect(checkbox("Cycle, modules and estimate")).toBeNull();
    expect(
      screen.getByText(/Status is matched to the new project's columns/),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Make a copy" }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p-ops",
        include: ["description", "assignees", "labels", "dates"],
      }),
      expect.any(Object),
    );
  });

  it("sends the chosen title, project and options", async () => {
    renderDialog();
    await screen.findByText("Make a copy of WEB-12");

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "  Signup page  " },
    });
    fireEvent.click(checkbox("Assignees") as HTMLElement);
    fireEvent.click(checkbox("Links") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Make a copy" }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        taskId: "task-1",
        projectId: "p-web",
        title: "Signup page",
        include: [
          "description",
          "labels",
          "dates",
          "customFields",
          "parent",
          "planning",
          "links",
        ],
        parentTaskId: "parent-1",
      },
      expect.any(Object),
    );
  });

  it("requires a title", async () => {
    renderDialog();
    await screen.findByText("Make a copy of WEB-12");
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Make a copy" }));

    expect(await screen.findByText("Title is required")).toBeVisible();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("reports what was not copied and opens the copy on request", async () => {
    mocks.mutate.mockImplementation((_variables, options) =>
      options.onSuccess({
        task: { id: "copy-1", projectId: "p-ops" },
        key: "OPS-4",
        skipped: ["attachments", "planning"],
      }),
    );
    renderDialog();
    await screen.findByText("Make a copy of WEB-12");
    fireEvent.click(screen.getByRole("button", { name: "Make a copy" }));

    expect(mocks.toast.success).toHaveBeenCalledWith("Copy created: OPS-4", {
      description: "Not copied: Attachments · Cycle, modules and estimate",
      action: { label: "Open", onClick: expect.any(Function) },
    });
    const [, options] = mocks.toast.success.mock.calls[0];
    options.action.onClick();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: { workspaceId: "ws-1", projectId: "p-ops", taskId: "copy-1" },
    });
  });

  it("keeps the dialog open and toasts the server message on failure", async () => {
    const onOpenChange = vi.fn();
    mocks.mutate.mockImplementation((_variables, options) =>
      options.onError(new Error("This project is archived")),
    );
    render(
      <CopyTaskDialog
        target={{ taskId: "task-1", projectId: "p-web", workspaceId: "ws-1" }}
        open
        onOpenChange={onOpenChange}
      />,
    );
    await screen.findByText("Make a copy of WEB-12");
    fireEvent.click(screen.getByRole("button", { name: "Make a copy" }));

    expect(mocks.toast.error).toHaveBeenCalledWith("This project is archived");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
