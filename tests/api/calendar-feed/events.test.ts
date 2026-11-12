import { describe, expect, it } from "vitest";
import {
  cycleEvent,
  FEED_MAX_EVENTS,
  type FeedContext,
  type FeedCycle,
  type FeedTask,
  feedEvents,
  feedWindow,
  sequenceOf,
  taskEvent,
} from "../../../apps/api/src/calendar-feed/events";
import {
  feedTokenStart,
  generateFeedToken,
  hashFeedToken,
  isFeedTokenShape,
} from "../../../apps/api/src/calendar-feed/token";

const ctx: FeedContext = {
  workspaceId: "w1",
  timezone: "UTC",
  today: "2026-11-13",
  webUrl: "https://margaya.test",
  showProject: false,
};

function task(overrides: Partial<FeedTask> = {}): FeedTask {
  return {
    id: "t1",
    title: "Ship the release",
    number: 12,
    projectId: "p1",
    projectSlug: "WEB",
    projectName: "Website",
    startDate: null,
    dueDate: new Date("2026-11-20T00:00:00.000Z"),
    isMilestone: false,
    completedAt: null,
    updatedAt: new Date("2026-11-10T08:00:00.000Z"),
    ...overrides,
  };
}

function cycle(overrides: Partial<FeedCycle> = {}): FeedCycle {
  return {
    id: "c1",
    name: "Sprint 4",
    projectId: "p1",
    projectName: "Website",
    startDate: "2026-11-09",
    endDate: "2026-11-22",
    updatedAt: new Date("2026-11-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("taskEvent", () => {
  it("makes a due date one all-day event with an exclusive end", () => {
    const event = taskEvent(task(), ctx);
    expect(event).toMatchObject({
      uid: "task-t1@margaya",
      startDate: "2026-11-20",
      endDate: "2026-11-21",
      summary: "Ship the release",
      url: "https://margaya.test/dashboard/workspace/w1/project/p1/task/t1",
      categories: ["Website"],
    });
    expect(event?.description).toBe(
      "WEB-12 · Website\nhttps://margaya.test/dashboard/workspace/w1/project/p1/task/t1",
    );
  });

  it("spans start to due, and uses a lone start date as one day", () => {
    expect(
      taskEvent(task({ startDate: new Date("2026-11-16T00:00:00Z") }), ctx),
    ).toMatchObject({ startDate: "2026-11-16", endDate: "2026-11-21" });
    expect(
      taskEvent(
        task({ startDate: new Date("2026-11-16T00:00:00Z"), dueDate: null }),
        ctx,
      ),
    ).toMatchObject({ startDate: "2026-11-16", endDate: "2026-11-17" });
  });

  it("skips tasks without dates", () => {
    expect(taskEvent(task({ dueDate: null }), ctx)).toBeNull();
  });

  it("reads the stored instant as a day in the feed's time zone", () => {
    // Picked as 15 November in a browser at UTC+05:30.
    const due = new Date("2026-11-14T18:30:00.000Z");
    expect(
      taskEvent(task({ dueDate: due }), { ...ctx, timezone: "Asia/Kolkata" }),
    ).toMatchObject({ startDate: "2026-11-15", endDate: "2026-11-16" });
    expect(taskEvent(task({ dueDate: due }), ctx)).toMatchObject({
      startDate: "2026-11-14",
    });
  });

  it("marks milestones and finished tasks, a milestone on its due day only", () => {
    const event = taskEvent(
      task({
        isMilestone: true,
        startDate: new Date("2026-11-01T00:00:00Z"),
        completedAt: new Date("2026-11-12T00:00:00Z"),
      }),
      ctx,
    );
    expect(event).toMatchObject({
      summary: "✓ ◆ Ship the release",
      startDate: "2026-11-20",
      endDate: "2026-11-21",
    });
  });

  it("names the project in workspace-wide feeds", () => {
    expect(taskEvent(task(), { ...ctx, showProject: true })?.summary).toBe(
      "Ship the release · Website",
    );
  });

  it("leaves out tasks outside the window", () => {
    const window = feedWindow(ctx.today);
    expect(window).toEqual({ first: "2026-08-15", last: "2027-11-13" });
    expect(
      taskEvent(task({ dueDate: new Date("2026-08-14T12:00:00Z") }), ctx),
    ).toBeNull();
    expect(
      taskEvent(task({ dueDate: new Date("2027-11-14T12:00:00Z") }), ctx),
    ).toBeNull();
    // A long task that started before the window but ends inside it stays.
    expect(
      taskEvent(
        task({
          startDate: new Date("2026-01-01T00:00:00Z"),
          dueDate: new Date("2026-08-20T00:00:00Z"),
        }),
        ctx,
      ),
    ).not.toBeNull();
  });
});

describe("sequenceOf", () => {
  it("grows with every later update and fits a 32-bit integer", () => {
    const earlier = sequenceOf(new Date("2026-11-10T08:00:00Z"));
    const later = sequenceOf(new Date("2026-11-10T08:00:01Z"));
    expect(later).toBe(earlier + 1);
    expect(sequenceOf(new Date("2019-01-01T00:00:00Z"))).toBe(0);
    expect(sequenceOf(new Date("2200-01-01T00:00:00Z"))).toBe(2_147_483_647);
  });
});

describe("cycleEvent and feedEvents", () => {
  it("makes a cycle one all-day range linking to the cycle", () => {
    expect(cycleEvent(cycle(), ctx)).toMatchObject({
      uid: "cycle-c1@margaya",
      startDate: "2026-11-09",
      endDate: "2026-11-23",
      summary: "↻ Sprint 4",
      url: "https://margaya.test/dashboard/workspace/w1/project/p1/cycles/c1",
    });
  });

  it("sorts by start day and caps the feed", () => {
    const events = feedEvents([task()], [cycle()], ctx);
    expect(events.map((event) => event.uid)).toEqual([
      "cycle-c1@margaya",
      "task-t1@margaya",
    ]);
    const many = Array.from({ length: FEED_MAX_EVENTS + 5 }, (_, index) =>
      task({ id: `t${index}` }),
    );
    expect(feedEvents(many, [], ctx)).toHaveLength(FEED_MAX_EVENTS);
  });
});

describe("feed tokens", () => {
  it("are random, URL-safe and recognisable before any lookup", () => {
    const token = generateFeedToken();
    expect(isFeedTokenShape(token)).toBe(true);
    expect(token).not.toBe(generateFeedToken());
    expect(isFeedTokenShape("mgcal_short")).toBe(false);
    expect(isFeedTokenShape(`${token}/../x`)).toBe(false);
  });

  it("store only a hash and a short start", () => {
    const token = generateFeedToken();
    expect(hashFeedToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFeedToken(token)).toBe(hashFeedToken(token));
    expect(feedTokenStart(token)).toHaveLength(10);
    expect(token.startsWith(feedTokenStart(token))).toBe(true);
  });
});
