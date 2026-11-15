import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WhiteboardTrashView from "./whiteboard-trash-view";

const m = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  restore: vi.fn(),
  purge: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/hooks/queries/trash/use-whiteboard-trash", () => ({
  useWhiteboardTrash: () => ({
    isPending: false,
    isError: false,
    data: { pages: [{ items: m.items }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock("@/hooks/mutations/trash/use-whiteboard-trash-mutations", () => ({
  useRestoreDeletedWhiteboard: () => ({
    mutateAsync: m.restore,
    isPending: false,
  }),
  usePurgeWhiteboard: () => ({ mutateAsync: m.purge, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: m.error },
}));

beforeEach(() => {
  m.items = [];
  m.restore.mockReset().mockResolvedValue({});
  m.purge.mockReset().mockResolvedValue({});
  m.success.mockReset();
  m.error.mockReset();
});

afterEach(cleanup);

describe("WhiteboardTrashView", () => {
  it("shows its empty state", () => {
    render(<WhiteboardTrashView projectId="p1" />);
    expect(
      screen.getByText("settings:trash.emptyWhiteboardsTitle"),
    ).toBeTruthy();
  });

  it("restores a deleted board", async () => {
    m.items = [
      {
        id: "wb1",
        title: "",
        deletedAt: "2026-11-10T00:00:00Z",
        deletedBy: null,
        purgeAt: "2026-12-10T00:00:00Z",
        canManage: true,
      },
    ];
    render(<WhiteboardTrashView projectId="p1" />);
    expect(screen.getByText("whiteboards:list.untitled")).toBeTruthy();
    fireEvent.click(
      screen.getByLabelText(
        'settings:trash.restoreAria {"name":"whiteboards:list.untitled"}',
      ),
    );
    await waitFor(() => expect(m.restore).toHaveBeenCalledWith("wb1"));
    await waitFor(() =>
      expect(m.success).toHaveBeenCalledWith(
        "settings:trash.toast.whiteboardRestored",
      ),
    );
  });
});
