import { describe, expect, it } from "vitest";
import { matchesGanttSearch, selectUndatedTasks } from "./undated-tasks";

const task = (
  id: string,
  startDate: string | null,
  dueDate: string | null,
  extra: Partial<{ title: string; number: number | null; status: string }> = {},
) => ({
  id,
  title: extra.title ?? id,
  number: extra.number ?? 1,
  status: extra.status ?? "to-do",
  startDate,
  dueDate,
});

describe("selectUndatedTasks", () => {
  const tasks = [
    task("dated", "2026-10-01", "2026-10-03"),
    task("due-only", null, "2026-10-03"),
    task("start-only", "2026-10-01", null),
    task("none", null, null),
    task("blank", "", ""),
    task("garbage", "not a date", null),
  ];

  it("keeps only the tasks with no usable date", () => {
    expect(selectUndatedTasks(tasks, "").map((entry) => entry.id)).toEqual([
      "none",
      "blank",
      "garbage",
    ]);
  });

  it("applies the timeline search to them as well", () => {
    expect(
      selectUndatedTasks(
        [
          task("a", null, null, { title: "Write spec", number: 4 }),
          task("b", null, null, { title: "Ship", number: 12 }),
        ],
        "rm-12",
        "RM",
      ).map((entry) => entry.id),
    ).toEqual(["b"]);
  });
});

describe("matchesGanttSearch", () => {
  const subject = { title: "Design review", number: 7, status: "in-review" };

  it("matches the title, the key and the status, ignoring case", () => {
    expect(matchesGanttSearch(subject, "", "RM")).toBe(true);
    expect(matchesGanttSearch(subject, "DESIGN", "RM")).toBe(true);
    expect(matchesGanttSearch(subject, "rm-7", "RM")).toBe(true);
    expect(matchesGanttSearch(subject, "in-review", "RM")).toBe(true);
    expect(matchesGanttSearch(subject, "ship", "RM")).toBe(false);
  });
});
