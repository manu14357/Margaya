import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase } from "./helpers/database";
import { queryScene, sorted } from "./helpers/task-query";

// Only Date is faked, so the database driver's timers keep running.
function freeze(instant: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(instant));
}

const at = (instant: string) => new Date(instant);

describe("API integration: task query date filters", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    // Saturday.
    freeze("2026-09-26T12:00:00.000Z");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("compares calendar days in the requester's zone", async () => {
    const s = await queryScene();
    const utcMidnight = await s.createTask({
      dueDate: at("2026-09-26T00:00:00.000Z"),
    });
    const laEvening = await s.createTask({
      dueDate: at("2026-09-27T03:00:00.000Z"),
    });
    const kolkataMidnight = await s.createTask({
      dueDate: at("2026-09-25T18:30:00.000Z"),
    });
    const nextUtcDay = await s.createTask({
      dueDate: at("2026-09-27T00:00:00.000Z"),
    });
    const on = { key: "dueDate", operator: "on", date: "2026-09-26" };

    expect(await s.ids(on)).toEqual([utcMidnight.id]);
    expect(
      await s.ids(on, { context: { timeZone: "America/Los_Angeles" } }),
    ).toEqual(sorted([laEvening.id, nextUtcDay.id]));
    expect(await s.ids(on, { context: { timeZone: "Asia/Kolkata" } })).toEqual(
      sorted([kolkataMidnight.id, utcMidnight.id]),
    );
  });

  it("includes both ends of on-or-before, on-or-after and between", async () => {
    const s = await queryScene();
    const [d20, d25, d26, d27] = await Promise.all(
      ["2026-09-20", "2026-09-25", "2026-09-26", "2026-09-27"].map((day) =>
        s.createTask({ dueDate: at(`${day}T00:00:00.000Z`) }),
      ),
    );
    if (!d20 || !d25 || !d26 || !d27) throw new Error("tasks");

    expect(
      await s.ids({
        key: "dueDate",
        operator: "onOrBefore",
        date: "2026-09-26",
      }),
    ).toEqual(sorted([d20.id, d25.id, d26.id]));
    expect(
      await s.ids({
        key: "dueDate",
        operator: "onOrAfter",
        date: "2026-09-26",
      }),
    ).toEqual(sorted([d26.id, d27.id]));
    expect(
      await s.ids({
        key: "dueDate",
        operator: "between",
        from: "2026-09-25",
        to: "2026-09-26",
      }),
    ).toEqual(sorted([d25.id, d26.id]));
    expect(
      await s.ids({
        key: "dueDate",
        operator: "between",
        from: "2026-09-26",
        to: "2026-09-26",
      }),
    ).toEqual([d26.id]);

    await s.refuse(
      {
        filters: {
          key: "dueDate",
          operator: "between",
          from: "2026-09-27",
          to: "2026-09-26",
        },
      },
      400,
      "Invalid date range",
    );
    await s.refuse(
      { filters: { key: "dueDate", operator: "on", date: "2026-02-30" } },
      400,
      "Invalid date",
    );
  });

  it.each([
    [0, ["2026-09-20", "2026-09-21", "2026-09-26"]],
    [1, ["2026-09-21", "2026-09-26", "2026-09-27"]],
    [6, ["2026-09-26", "2026-09-27", "2026-10-02"]],
  ] as const)("starts this week on day %i", async (weekStartsOn, expected) => {
    const s = await queryScene();
    const byDay = new Map<string, string>();
    for (const day of [
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
      "2026-09-26",
      "2026-09-27",
      "2026-10-02",
      "2026-10-03",
    ]) {
      const task = await s.createTask({ dueDate: at(`${day}T00:00:00.000Z`) });
      byDay.set(day, task.id);
    }
    expect(
      await s.ids(
        { key: "dueDate", operator: "in", values: ["thisWeek"] },
        { context: { weekStartsOn } },
      ),
    ).toEqual(sorted(expected.map((day) => byDay.get(day) ?? "")));
  });

  it("finds last month across a year boundary", async () => {
    freeze("2027-01-10T12:00:00.000Z");
    const s = await queryScene();
    await s.createTask({ dueDate: at("2026-11-30T00:00:00.000Z") });
    const first = await s.createTask({
      dueDate: at("2026-12-01T00:00:00.000Z"),
    });
    const last = await s.createTask({
      dueDate: at("2026-12-31T23:00:00.000Z"),
    });
    await s.createTask({ dueDate: at("2027-01-01T00:00:00.000Z") });

    expect(
      await s.ids({ key: "dueDate", operator: "in", values: ["lastMonth"] }),
    ).toEqual(sorted([first.id, last.id]));
  });

  it("applies rolling windows", async () => {
    const s = await queryScene();
    const task = async (day: string) =>
      (await s.createTask({ dueDate: at(`${day}T00:00:00.000Z`) })).id;
    const sep11 = await task("2026-09-11");
    const sep12 = await task("2026-09-12");
    const sep19 = await task("2026-09-19");
    const sep20 = await task("2026-09-20");
    const sep26 = await task("2026-09-26");
    const oct2 = await task("2026-10-02");
    const oct3 = await task("2026-10-03");

    expect(
      await s.ids({
        key: "dueDate",
        operator: "withinNext",
        amount: 7,
        unit: "days",
      }),
    ).toEqual(sorted([sep26, oct2]));
    expect(
      await s.ids({
        key: "dueDate",
        operator: "withinLast",
        amount: 1,
        unit: "weeks",
      }),
    ).toEqual(sorted([sep20, sep26]));
    expect(
      await s.ids({
        key: "dueDate",
        operator: "moreThanAgo",
        amount: 2,
        unit: "weeks",
      }),
    ).toEqual([sep11]);
    expect(
      await s.ids({
        key: "dueDate",
        operator: "moreThanAhead",
        amount: 6,
        unit: "days",
      }),
    ).toEqual([oct3]);
    expect([sep12, sep19]).toHaveLength(2);
  });

  it("matches set, unset, past and future dates", async () => {
    const s = await queryScene();
    const unset = await s.createTask({ dueDate: null });
    const past = await s.createTask({
      dueDate: at("2026-09-25T00:00:00.000Z"),
    });
    const today = await s.createTask({
      dueDate: at("2026-09-26T00:00:00.000Z"),
    });
    const future = await s.createTask({
      dueDate: at("2026-09-27T00:00:00.000Z"),
    });

    expect(await s.ids({ key: "dueDate", operator: "empty" })).toEqual([
      unset.id,
    ]);
    expect(await s.ids({ key: "dueDate", operator: "notEmpty" })).toEqual(
      sorted([past.id, today.id, future.id]),
    );
    expect(
      await s.ids({
        key: "dueDate",
        operator: "in",
        values: ["past", "none"],
      }),
    ).toEqual(sorted([unset.id, past.id]));
    expect(
      await s.ids({ key: "dueDate", operator: "in", values: ["future"] }),
    ).toEqual([future.id]);
    expect(
      await s.ids({ key: "dueDate", operator: "in", values: ["today"] }),
    ).toEqual([today.id]);
  });

  it("filters completion and update days", async () => {
    const s = await queryScene();
    const doneToday = await s.createTask({
      status: "done",
      completedAt: at("2026-09-26T09:00:00.000Z"),
      updatedAt: at("2026-09-26T09:00:00.000Z"),
    });
    const doneEarlier = await s.createTask({
      status: "done",
      completedAt: at("2026-09-01T09:00:00.000Z"),
      updatedAt: at("2026-09-01T09:00:00.000Z"),
    });
    await s.createTask({ updatedAt: at("2026-08-01T09:00:00.000Z") });

    expect(
      await s.ids({ key: "completedAt", operator: "in", values: ["today"] }),
    ).toEqual([doneToday.id]);
    expect(await s.ids({ key: "completedAt", operator: "notEmpty" })).toEqual(
      sorted([doneToday.id, doneEarlier.id]),
    );
    expect(
      await s.ids({
        key: "updatedAt",
        operator: "withinLast",
        amount: 30,
        unit: "days",
      }),
    ).toEqual(sorted([doneToday.id, doneEarlier.id]));
    expect(await s.ids({ key: "createdAt", operator: "empty" })).toEqual([]);
  });

  it("reports today in the requester's zone and refuses unknown zones", async () => {
    freeze("2026-09-26T20:00:00.000Z");
    const s = await queryScene();
    expect((await s.query({ mode: "counts" })).today).toBe("2026-09-26");
    expect(
      (
        await s.query({
          mode: "counts",
          context: { timeZone: "Asia/Kolkata" },
        })
      ).today,
    ).toBe("2026-09-27");
    await s.refuse(
      { context: { timeZone: "Mars/Olympus" } },
      400,
      "Unknown time zone",
    );
  });
});
