import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DescriptionHistoryDialog from "./description-history-dialog";

const m = vi.hoisted(() => ({
  mutate: vi.fn(),
  toastSuccess: vi.fn(),
  canUpdate: true,
  versions: [] as Array<Record<string, unknown>>,
  requestedVersion: [] as Array<string | undefined>,
}));

vi.mock("@/lib/i18n", () => ({
  i18n: { t: (key: string) => key, language: "en-US" },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.count !== undefined ? `${key}:${options.count}` : key,
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.toastSuccess, error: vi.fn() },
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => m.canUpdate }),
}));
vi.mock(
  "@/hooks/queries/task-description-version/use-description-versions",
  () => ({
    useDescriptionVersions: () => ({
      data: m.versions,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
  }),
);
vi.mock(
  "@/hooks/queries/task-description-version/use-description-version",
  () => ({
    useDescriptionVersion: (_taskId: string, versionId?: string) => {
      m.requestedVersion.push(versionId);
      return {
        data: {
          id: versionId,
          savedAt: "2026-10-01T10:00:00.000Z",
          content: `content of ${versionId}`,
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    },
  }),
);
vi.mock(
  "@/hooks/mutations/task-description-version/use-restore-description-version",
  () => ({
    useRestoreDescriptionVersion: () => ({
      mutate: m.mutate,
      isPending: false,
    }),
  }),
);
vi.mock("@/components/public-project/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="rendered">{content}</div>
  ),
}));

function version(id: string, name: string | null, preview: string) {
  return {
    id,
    taskId: "t1",
    authorId: name ? `u-${name}` : null,
    author: name ? { id: `u-${name}`, name, image: null } : null,
    savedAt: "2026-10-01T10:00:00.000Z",
    createdAt: "2026-10-01T10:00:00.000Z",
    size: preview.length,
    preview,
  };
}

afterEach(cleanup);
beforeEach(() => {
  m.mutate.mockReset();
  m.toastSuccess.mockReset();
  m.canUpdate = true;
  m.requestedVersion = [];
  m.versions = [
    version("v3", "Ana", "Newest text"),
    version("v2", "Ben", "Older text"),
    version("v1", null, "Original text"),
  ];
});

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <DescriptionHistoryDialog
      taskId="t1"
      projectId="p1"
      open
      onOpenChange={onOpenChange}
    />,
  );
  return onOpenChange;
}

describe("DescriptionHistoryDialog", () => {
  it("lists versions with author, size and preview, newest selected", () => {
    renderDialog();
    const list = screen.getByRole("list", {
      name: "tasks:descriptionHistory.list",
    });
    expect(list.textContent).toContain("Ana");
    expect(list.textContent).toContain("Newest text");
    expect(list.textContent).toContain("tasks:descriptionHistory.size:11");
    // A version without an author is the text from before the history.
    expect(list.textContent).toContain(
      "tasks:descriptionHistory.earlierVersion",
    );
    expect(screen.getByTestId("rendered").textContent).toBe("content of v3");
    // The newest version is the current text: nothing to restore.
    expect(
      screen.queryByRole("button", {
        name: "tasks:descriptionHistory.restore",
      }),
    ).toBeNull();
  });

  it("restores an older version after confirming, then closes", () => {
    const onOpenChange = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Older text/ }));
    expect(screen.getByTestId("rendered").textContent).toBe("content of v2");

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:descriptionHistory.restore" }),
    );
    expect(m.mutate).not.toHaveBeenCalled();
    expect(
      screen.getByText("tasks:descriptionHistory.restoreConfirmTitle"),
    ).toBeTruthy();

    const confirm = screen
      .getAllByRole("button", { name: "tasks:descriptionHistory.restore" })
      .at(-1);
    if (!confirm) throw new Error("no confirm button");
    fireEvent.click(confirm);
    expect(m.mutate).toHaveBeenCalledWith(
      { taskId: "t1", projectId: "p1", versionId: "v2" },
      expect.any(Object),
    );

    const callbacks = m.mutate.mock.calls[0]?.[1] as { onSuccess: () => void };
    callbacks.onSuccess();
    expect(m.toastSuccess).toHaveBeenCalledWith(
      "tasks:descriptionHistory.restored",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers no restore without task:update", () => {
    m.canUpdate = false;
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Older text/ }));
    expect(
      screen.queryByRole("button", {
        name: "tasks:descriptionHistory.restore",
      }),
    ).toBeNull();
  });

  it("says when there is no history yet", () => {
    m.versions = [];
    renderDialog();
    expect(screen.getByText("tasks:descriptionHistory.empty")).toBeTruthy();
  });
});
