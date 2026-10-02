import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StickiesPage from "./stickies-page";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  reorder: vi.fn(),
  queries: [] as string[],
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/common/header/top-bar", () => ({
  TopBar: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header>,
}));
vi.mock("@/hooks/queries/sticky/use-get-stickies", () => ({
  STICKY_PAGE_SIZE: 30,
  default: ({ q }: { q: string }) => {
    mocks.queries.push(q);
    const items = ["a", "b"].map((id) => ({
      id,
      workspaceId: "ws-1",
      content: `note ${id}`,
      color: "yellow",
      position: 0,
      createdAt: "",
      updatedAt: "",
    }));
    return {
      data: { pages: [{ items, nextCursor: null }], pageParams: [null] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: vi.fn(),
      fetchNextPage: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/mutations/sticky/use-sticky-mutations", () => ({
  useReorderStickies: () => ({ mutate: mocks.reorder }),
}));
vi.mock("./use-add-sticky", () => ({
  useAddSticky: () => ({ add: mocks.add, isPending: false }),
}));
// Cards are covered by their own test; the stand-in shows the drag handle.
vi.mock("./sticky-card", () => ({
  default: ({
    sticky,
    dragHandle,
  }: {
    sticky: { id: string };
    dragHandle?: ReactNode;
  }) => <div data-testid={`card-${sticky.id}`}>{dragHandle}</div>,
}));

beforeEach(() => {
  mocks.queries = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StickiesPage", () => {
  it("offers drag handles, then none while a search is active", async () => {
    render(<StickiesPage workspaceId="ws-1" />);
    expect(screen.getAllByLabelText("stickies:reorder")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("stickies:search.open"));
    fireEvent.change(screen.getByLabelText("stickies:search.placeholder"), {
      target: { value: "  note " },
    });

    await waitFor(() => expect(mocks.queries).toContain("note"));
    expect(screen.queryAllByLabelText("stickies:reorder")).toHaveLength(0);
  });

  it("runs the create flow once for new=true and clears the flag", () => {
    const onCreateHandled = vi.fn();
    const { rerender } = render(
      <StickiesPage
        workspaceId="ws-1"
        createOnLoad
        onCreateHandled={onCreateHandled}
      />,
    );
    rerender(
      <StickiesPage
        workspaceId="ws-1"
        createOnLoad
        onCreateHandled={onCreateHandled}
      />,
    );

    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(onCreateHandled).toHaveBeenCalledTimes(1);
  });

  it("adds from the header", () => {
    render(<StickiesPage workspaceId="ws-1" />);
    fireEvent.click(screen.getByRole("button", { name: "stickies:add" }));
    expect(mocks.add).toHaveBeenCalledTimes(1);
  });
});
