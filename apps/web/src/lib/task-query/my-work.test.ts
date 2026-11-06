import { describe, expect, it } from "vitest";
import {
  DEFAULT_MY_WORK_TAB,
  isMyWorkTab,
  MY_WORK_TABS,
  myWorkTabSearch,
  presetFilters,
} from "./my-work";

describe("Your work tabs", () => {
  it("opens on Assigned and keeps Summary as a later tab", () => {
    expect(DEFAULT_MY_WORK_TAB).toBe("assigned");
    expect(MY_WORK_TABS[0]).toBe("assigned");
    expect(MY_WORK_TABS.at(-1)).toBe("summary");
    expect(isMyWorkTab("summary")).toBe(true);
  });

  it("names every tab in the URL except the one it opens on", () => {
    expect(myWorkTabSearch("assigned")).toBeUndefined();
    expect(myWorkTabSearch("summary")).toBe("summary");
    expect(myWorkTabSearch("created")).toBe("created");
  });
});

describe("presetFilters", () => {
  it("narrows dueToday to open work due today", () => {
    expect(presetFilters("dueToday")).toEqual({
      op: "and",
      children: [
        {
          key: "group",
          operator: "in",
          values: ["backlog", "unstarted", "started"],
        },
        { key: "dueDate", operator: "in", values: ["today"] },
      ],
    });
  });
});
