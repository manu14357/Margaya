import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@/types/page";
import PageVersionPreview from "./page-version-preview";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  onClose: vi.fn(),
}));

vi.mock("@/lib/i18n", () => ({
  i18n: { t: (key: string) => key, language: "en-US" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/queries/page/use-get-page-version", () => ({
  useGetPageVersion: () => ({
    data: {
      id: "v1",
      pageId: "page_1",
      ownerId: "u1",
      contributorIds: ["u1"],
      title: "Old title",
      lastSavedAt: "2026-10-01T10:00:00.000Z",
      createdAt: "2026-10-01T10:00:00.000Z",
      contentJson: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Before" }] },
        ],
      },
      contentMarkdown: "Before",
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/mutations/page/use-restore-page-version", () => ({
  useRestorePageVersion: () => ({ mutate: mocks.mutate, isPending: false }),
}));

vi.mock("./page-editor/page-editor", () => ({
  default: ({
    editable,
    content,
  }: {
    editable: boolean;
    content: { value: unknown };
  }) => (
    <div data-testid="editor" data-editable={String(editable)}>
      {JSON.stringify(content.value)}
    </div>
  ),
}));

function makePage(canRestoreVersion: boolean): Page {
  return {
    id: "page_1",
    projectId: "p1",
    capabilities: { canRestoreVersion },
  } as unknown as Page;
}

afterEach(() => {
  cleanup();
  mocks.mutate.mockReset();
  mocks.onClose.mockReset();
});

describe("PageVersionPreview", () => {
  it("shows the version's content read-only", () => {
    render(
      <PageVersionPreview
        page={makePage(true)}
        workspaceId="w1"
        versionId="v1"
        onClose={mocks.onClose}
      />,
    );
    const editor = screen.getByTestId("editor");
    expect(editor).toHaveAttribute("data-editable", "false");
    expect(editor.textContent).toContain("Before");
    expect(screen.getByText("Old title")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /pages:history.backToCurrent/ }),
    );
    expect(mocks.onClose).toHaveBeenCalled();
  });

  it("asks before restoring, then restores", async () => {
    render(
      <PageVersionPreview
        page={makePage(true)}
        workspaceId="w1"
        versionId="v1"
        onClose={mocks.onClose}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "pages:history.restore" }),
    );
    expect(
      await screen.findByText("pages:history.restoreConfirmTitle"),
    ).toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole("button", {
      name: "pages:history.restore",
    });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(mocks.mutate).toHaveBeenCalledWith(
      { pageId: "page_1", projectId: "p1", versionId: "v1" },
      expect.any(Object),
    );
  });

  it("hides Restore without canRestoreVersion", () => {
    render(
      <PageVersionPreview
        page={makePage(false)}
        workspaceId="w1"
        versionId="v1"
        onClose={mocks.onClose}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "pages:history.restore" }),
    ).toBeNull();
  });
});
