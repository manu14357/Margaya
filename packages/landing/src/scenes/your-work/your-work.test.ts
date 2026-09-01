import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { YOUR_WORK_TABS, yourWorkReducer } from "./state";
import { createYourWorkScene, TAB_TASKS } from "./your-work-scene";

const scene = createYourWorkScene();

describe("your work scene", () => {
  it("switches tabs and ignores the current one", () => {
    const state = { tab: "assigned" } as const;
    expect(yourWorkReducer(state, { type: "tab", tab: "assigned" })).toBe(
      state,
    );
    expect(yourWorkReducer(state, { type: "tab", tab: "created" }).tab).toBe(
      "created",
    );
  });

  it("gives every tab tasks whose titles exist in copy", () => {
    const titles = messages.landing.demo.yourWork.tasks;
    for (const tab of YOUR_WORK_TABS) {
      expect(TAB_TASKS[tab].length).toBeGreaterThan(0);
      for (const task of TAB_TASKS[tab]) expect(titles[task.id]).toBeTruthy();
    }
  });

  it("ends on the Subscribed tab", () => {
    expect(finalStateOf(scene).tab).toBe("subscribed");
  });
});
