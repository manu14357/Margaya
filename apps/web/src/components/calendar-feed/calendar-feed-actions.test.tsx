import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CalendarFeed,
  CreatedCalendarFeed,
} from "@/fetchers/calendar-feed/calendar-feeds";
import {
  CalendarFeedActions,
  CalendarFeedStatus,
} from "./calendar-feed-actions";

const { revoke, desktop } = vi.hoisted(() => ({
  revoke: vi.fn(),
  desktop: { value: false },
}));

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/calendar-feed/use-calendar-feed-mutations", () => ({
  useRevokeCalendarFeed: () => ({ mutateAsync: revoke, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/desktop", () => ({ isDesktopApp: () => desktop.value }));

const feed = {
  id: "f1",
  kind: "my_tasks",
  workspaceId: "w1",
  projectId: null,
  projectName: null,
  name: "My tasks · Studio",
  tokenStart: "mgcal_abcd",
  createdAt: "2026-11-01T10:00:00.000Z",
  lastUsedAt: null,
} as CalendarFeed;

const created = {
  ...feed,
  url: "https://margaya.test/api/calendar-feed/mgcal_secret/feed.ics",
  webcalUrl: "webcal://margaya.test/api/calendar-feed/mgcal_secret/feed.ics",
} as CreatedCalendarFeed;

describe("CalendarFeedActions", () => {
  afterEach(() => {
    cleanup();
    revoke.mockReset();
    desktop.value = false;
  });

  it("creates a feed and shows its URL once, with an open link", async () => {
    const create = vi.fn().mockResolvedValue(created);
    render(
      <CalendarFeedActions feed={undefined} label="My tasks" create={create} />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:calendarFeed.actions.createFor",
      }),
    );

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(await screen.findByDisplayValue(created.url)).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "settings:calendarFeed.actions.open",
      }),
    ).toHaveAttribute("href", created.webcalUrl);
    expect(
      screen.getByText("settings:calendarFeed.link.once"),
    ).toBeInTheDocument();
  });

  it("hides the webcal link inside the desktop app", async () => {
    desktop.value = true;
    const create = vi.fn().mockResolvedValue(created);
    render(
      <CalendarFeedActions feed={undefined} label="My tasks" create={create} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:calendarFeed.actions.createFor",
      }),
    );
    expect(await screen.findByDisplayValue(created.url)).toBeInTheDocument();
    expect(
      screen.queryByText("settings:calendarFeed.actions.open"),
    ).not.toBeInTheDocument();
  });

  it("asks before revoking an existing feed", async () => {
    revoke.mockResolvedValue({ id: "f1" });
    render(
      <CalendarFeedActions feed={feed} label="My tasks" create={vi.fn()} />,
    );

    expect(
      screen.queryByRole("button", {
        name: "settings:calendarFeed.actions.createFor",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:calendarFeed.actions.revokeFor",
      }),
    );
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings:calendarFeed.revokeConfirm.confirm",
      }),
    );
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("f1"));
  });

  it("asks before regenerating, then shows the new URL", async () => {
    const create = vi.fn().mockResolvedValue(created);
    render(
      <CalendarFeedActions feed={feed} label="My tasks" create={create} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:calendarFeed.actions.regenerateFor",
      }),
    );
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings:calendarFeed.regenerateConfirm.confirm",
      }),
    );
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(await screen.findByDisplayValue(created.url)).toBeInTheDocument();
  });
});

describe("CalendarFeedStatus", () => {
  afterEach(cleanup);

  it("says when there is no link yet", () => {
    render(<CalendarFeedStatus feed={undefined} />);
    expect(
      screen.getByText("settings:calendarFeed.status.none"),
    ).toBeInTheDocument();
  });

  it("shows that an existing link was never read", () => {
    render(<CalendarFeedStatus feed={feed} />);
    expect(
      screen.getByText(/settings:calendarFeed.status.neverUsed/),
    ).toBeInTheDocument();
  });
});
