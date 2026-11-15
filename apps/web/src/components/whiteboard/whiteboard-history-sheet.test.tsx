import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { handleWhiteboardHint } from "@/lib/whiteboards/whiteboard-realtime";
import WhiteboardHistorySheet from "./whiteboard-history-sheet";

const m = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
    i18n: { language: "en-US" },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/fetchers/whiteboard/whiteboard-activity", () => ({
  listWhiteboardActivity: m.list,
}));

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

function entry(
  id: string,
  action: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    action,
    actor: { id: "u-ben", name: "Ben Ito", image: null },
    title: "Sprint 12",
    createdAt: minutesAgo(5),
    ...extra,
  };
}

function setup({ open = true } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <WhiteboardHistorySheet
        whiteboardId="wb1"
        open={open}
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
  return { queryClient, onOpenChange };
}

beforeEach(() => {
  m.list.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("WhiteboardHistorySheet", () => {
  it("doesn't load while closed", () => {
    setup({ open: false });
    expect(m.list).not.toHaveBeenCalled();
    expect(screen.queryByText("whiteboards:history.title")).toBeNull();
  });

  it("lists entries newest first with the actor, the time and what happened", async () => {
    m.list.mockResolvedValue({
      items: [
        entry("a3", "edited", { createdAt: minutesAgo(2) }),
        entry("a2", "renamed", {
          actor: {
            id: "u-cara",
            name: "Cara Diaz",
            image: "https://example.test/c.png",
          },
          title: "Sprint 12",
        }),
        entry("a1", "created", { actor: null, title: "" }),
      ],
      nextCursor: null,
    });
    setup();

    const list = await screen.findByRole("list", {
      name: "whiteboards:history.title",
    });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(m.list).toHaveBeenCalledWith("wb1", null);

    expect(within(rows[0] as HTMLElement).getByText("Ben Ito")).toBeTruthy();
    expect(
      within(rows[0] as HTMLElement).getByText(
        'whiteboards:history.entries.edited {"title":"Sprint 12"}',
      ),
    ).toBeTruthy();
    const time = (rows[0] as HTMLElement).querySelector("time");
    expect(time?.getAttribute("dateTime")).toBeTruthy();
    expect(time?.textContent).toMatch(/2/);

    expect(within(rows[1] as HTMLElement).getByText("Cara Diaz")).toBeTruthy();
    expect(
      within(rows[1] as HTMLElement).getByText(
        'whiteboards:history.entries.renamed {"title":"Sprint 12"}',
      ),
    ).toBeTruthy();

    // A deleted account reads as "Someone"; an empty title as Untitled.
    expect(
      within(rows[2] as HTMLElement).getByText("whiteboards:history.someone"),
    ).toBeTruthy();
    expect(
      within(rows[2] as HTMLElement).getByText(
        'whiteboards:history.entries.created {"title":"whiteboards:list.untitled"}',
      ),
    ).toBeTruthy();
    expect(screen.queryByText("whiteboards:history.loadMore")).toBeNull();
  });

  it("loads older pages with the cursor", async () => {
    m.list
      .mockResolvedValueOnce({
        items: [entry("a2", "locked")],
        nextCursor: "c1",
      })
      .mockResolvedValueOnce({
        items: [entry("a1", "created")],
        nextCursor: null,
      });
    setup();

    fireEvent.click(await screen.findByText("whiteboards:history.loadMore"));
    await screen.findByText(
      'whiteboards:history.entries.created {"title":"Sprint 12"}',
    );
    expect(m.list).toHaveBeenLastCalledWith("wb1", "c1");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("whiteboards:history.loadMore")).toBeNull();
  });

  it("shows the empty state", async () => {
    m.list.mockResolvedValue({ items: [], nextCursor: null });
    setup();
    expect(await screen.findByText("whiteboards:history.empty")).toBeTruthy();
  });

  it("shows an error with a retry", async () => {
    m.list.mockRejectedValueOnce(new HttpError(404, "Whiteboard not found"));
    m.list.mockResolvedValueOnce({
      items: [entry("a1", "archived")],
      nextCursor: null,
    });
    setup();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "whiteboards:history.loadError",
    );
    fireEvent.click(screen.getByText("whiteboards:list.retry"));
    expect(
      await screen.findByText(
        'whiteboards:history.entries.archived {"title":"Sprint 12"}',
      ),
    ).toBeTruthy();
  });

  it("refetches on the board's whiteboard.changed hint", async () => {
    m.list.mockResolvedValueOnce({
      items: [entry("a1", "created")],
      nextCursor: null,
    });
    m.list.mockResolvedValueOnce({
      items: [entry("a2", "published"), entry("a1", "created")],
      nextCursor: null,
    });
    const { queryClient } = setup();
    await screen.findByText(
      'whiteboards:history.entries.created {"title":"Sprint 12"}',
    );

    handleWhiteboardHint(queryClient, {
      type: "whiteboard.changed",
      projectId: "p1",
      whiteboardId: "wb1",
    });
    await waitFor(() => expect(m.list).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(
        'whiteboards:history.entries.published {"title":"Sprint 12"}',
      ),
    ).toBeTruthy();
  });
});
