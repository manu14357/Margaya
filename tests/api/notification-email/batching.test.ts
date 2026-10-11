import { describe, expect, it } from "vitest";
import {
  batchDueBefore,
  DEFAULT_EMAIL_BATCH_WINDOW_SECONDS,
  parseEmailBatchWindowSeconds,
} from "../../../apps/api/src/notification-email/batch-window";
import {
  type BatchItem,
  batchSubject,
  groupBatchItems,
} from "../../../apps/api/src/notification-email/grouping";

describe("parseEmailBatchWindowSeconds", () => {
  it("defaults to five minutes when unset, blank or not a number", () => {
    expect(DEFAULT_EMAIL_BATCH_WINDOW_SECONDS).toBe(300);
    expect(parseEmailBatchWindowSeconds(undefined)).toBe(300);
    expect(parseEmailBatchWindowSeconds("")).toBe(300);
    expect(parseEmailBatchWindowSeconds("  ")).toBe(300);
    expect(parseEmailBatchWindowSeconds("soon")).toBe(300);
  });

  it("keeps 0 as immediate delivery and clamps the rest", () => {
    expect(parseEmailBatchWindowSeconds("0")).toBe(0);
    expect(parseEmailBatchWindowSeconds("-5")).toBe(0);
    expect(parseEmailBatchWindowSeconds("90.7")).toBe(90);
    expect(parseEmailBatchWindowSeconds("999999")).toBe(86_400);
  });
});

describe("batchDueBefore", () => {
  it("subtracts the window from now", () => {
    const now = new Date("2026-10-14T10:00:00.000Z");
    expect(batchDueBefore(now, 300).toISOString()).toBe(
      "2026-10-14T09:55:00.000Z",
    );
    expect(batchDueBefore(now, 0).toISOString()).toBe(now.toISOString());
  });
});

function item(
  id: string,
  minute: number,
  task: BatchItem["task"],
  overrides: Partial<BatchItem> = {},
): BatchItem {
  return {
    notificationId: id,
    createdAt: new Date(Date.UTC(2026, 9, 14, 10, minute)),
    title: `Title ${id}`,
    body: `Body ${id}`,
    actorName: "Ada",
    task,
    workspaceName: "Acme",
    ...overrides,
  };
}

const launch = {
  id: "task-launch",
  title: "Launch plan",
  url: "https://m.example/task/launch",
  projectName: "Website",
};
const pricing = {
  id: "task-pricing",
  title: "Pricing",
  url: "https://m.example/task/pricing",
  projectName: "Website",
};

describe("groupBatchItems", () => {
  it("groups changes by task in the order they first happened", () => {
    const groups = groupBatchItems([
      item("n3", 3, launch, { actorName: null }),
      item("n2", 2, pricing),
      item("n1", 1, launch),
    ]);
    expect(groups.map((group) => group.id)).toEqual([
      "task-launch",
      "task-pricing",
    ]);
    const [first] = groups;
    expect(first?.title).toBe("Launch plan");
    expect(first?.context).toBe("Acme / Website");
    expect(first?.url).toBe(launch.url);
    expect(first?.changes).toEqual([
      { id: "n1", summary: "Title n1", detail: "Body n1", actorName: "Ada" },
      { id: "n3", summary: "Title n3", detail: "Body n3", actorName: null },
    ]);
  });

  it("keeps notifications without a task as their own entries", () => {
    const groups = groupBatchItems([item("w1", 1, null), item("w2", 2, null)]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      id: "w1",
      title: "Title w1",
      context: "Acme",
      url: null,
    });
  });
});

describe("batchSubject", () => {
  it("names the task when every change is on one task", () => {
    const groups = groupBatchItems([
      item("a", 1, launch),
      item("b", 2, launch),
    ]);
    expect(batchSubject(groups)).toBe("2 updates on Launch plan");
  });

  it("counts every change otherwise", () => {
    const groups = groupBatchItems([
      item("a", 1, launch),
      item("b", 2, pricing),
      item("c", 3, pricing),
    ]);
    expect(batchSubject(groups)).toBe("3 updates in Margaya");
  });
});
