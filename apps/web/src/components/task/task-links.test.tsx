import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import TaskLinks from "./task-links";

const mocks = vi.hoisted(() => ({
  links: [] as unknown[],
  canUpdate: true,
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/task-link/use-get-task-links", () => ({
  default: () => ({
    data: mocks.links,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/mutations/task-link/use-create-task-link", () => ({
  default: () => ({ mutateAsync: mocks.create, isPending: false }),
}));
vi.mock("@/hooks/mutations/task-link/use-update-task-link", () => ({
  default: () => ({ mutateAsync: mocks.update, isPending: false }),
}));
vi.mock("@/hooks/mutations/task-link/use-delete-task-link", () => ({
  default: () => ({ mutate: mocks.remove, isPending: false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => mocks.canUpdate }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

function link(overrides: Record<string, unknown>) {
  return {
    id: "link-1",
    taskId: "task-1",
    url: "https://example.com/spec",
    title: "Spec",
    host: "example.com",
    createdBy: { id: "user-1", name: "Ada", image: null },
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

const GITHUB_PATH = 'path[d^="M12 .297"]';

beforeEach(() => {
  mocks.links = [];
  mocks.canUpdate = true;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskLinks", () => {
  it("renders no section without links", () => {
    render(<TaskLinks taskId="task-1" />);
    expect(screen.queryByText("tasks:links.title")).toBeNull();
  });

  it("shows each link's title and real host, opening safely", () => {
    mocks.links = [
      link({}),
      link({
        id: "link-2",
        url: "https://docs.example.org/",
        title: null,
        host: "docs.example.org",
      }),
    ];
    render(<TaskLinks taskId="task-1" />);

    expect(screen.getByText("tasks:links.title")).toBeInTheDocument();
    const spec = screen.getByText("Spec").closest("a");
    expect(spec).toHaveAttribute("href", "https://example.com/spec");
    expect(spec).toHaveAttribute("target", "_blank");
    expect(spec?.getAttribute("rel")).toContain("noopener");
    expect(spec?.getAttribute("rel")).toContain("noreferrer");
    expect(within(spec as HTMLElement).getByText("example.com")).toBeVisible();
    // Without a title the host is the label, and still shown as the host.
    expect(screen.getAllByText("docs.example.org")).toHaveLength(2);
  });

  it("uses the GitHub mark for GitHub hosts only", () => {
    mocks.links = [
      link({
        id: "gh",
        url: "https://github.com/acme/app/pull/1",
        title: "PR 1",
        host: "github.com",
      }),
      link({}),
    ];
    const { container } = render(<TaskLinks taskId="task-1" />);
    const rows = container.querySelectorAll(".group\\/link");
    expect(rows[0].querySelector(GITHUB_PATH)).not.toBeNull();
    expect(rows[1].querySelector(GITHUB_PATH)).toBeNull();
  });

  it("gives viewers no add button and no row menu", () => {
    mocks.canUpdate = false;
    mocks.links = [link({})];
    render(<TaskLinks taskId="task-1" />);

    expect(
      screen.queryByRole("button", { name: "tasks:links.moreActions" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "tasks:links.add" }),
    ).toBeNull();
    // Copying stays available to everyone.
    expect(
      screen.getByRole("button", { name: "tasks:links.copyUrl" }),
    ).toBeInTheDocument();
  });

  it("validates the URL inline before saving", async () => {
    mocks.links = [link({})];
    render(<TaskLinks taskId="task-1" />);
    fireEvent.click(screen.getByRole("button", { name: "tasks:links.add" }));

    const url = await screen.findByLabelText("tasks:links.url");
    const save = screen.getByRole("button", { name: "tasks:links.save" });

    fireEvent.click(save);
    expect(
      await screen.findByText("tasks:links.errors.required"),
    ).toBeInTheDocument();

    fireEvent.change(url, { target: { value: "javascript:alert(1)" } });
    fireEvent.click(save);
    expect(
      await screen.findByText("tasks:links.errors.invalid"),
    ).toBeInTheDocument();

    fireEvent.change(url, { target: { value: "https://ada:pw@example.com" } });
    fireEvent.click(save);
    expect(
      await screen.findByText("tasks:links.errors.credentials"),
    ).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("saves the normalized URL and shows a duplicate inline", async () => {
    mocks.links = [link({})];
    mocks.create.mockRejectedValue(
      new HttpError(409, "This link is already on this task"),
    );
    render(<TaskLinks taskId="task-1" />);
    fireEvent.click(screen.getByRole("button", { name: "tasks:links.add" }));

    fireEvent.change(await screen.findByLabelText("tasks:links.url"), {
      target: { value: "example.com/spec" },
    });
    fireEvent.change(screen.getByLabelText("tasks:links.linkTitle"), {
      target: { value: "  Spec  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "tasks:links.save" }));

    expect(
      await screen.findByText("tasks:links.errors.duplicate"),
    ).toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledWith({
      taskId: "task-1",
      url: "https://example.com/spec",
      title: "Spec",
    });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
