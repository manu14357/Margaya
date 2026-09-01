import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { createInboxScene, READ_ID, SNOOZED_ID } from "./inbox-scene";
import { inboxReducer, unreadCount, visibleItems } from "./state";

const scene = createInboxScene(messages.landing.demo);

describe("inbox scene", () => {
  it("starts with three unread of five", () => {
    expect(visibleItems(scene.initialState)).toHaveLength(5);
    expect(unreadCount(scene.initialState)).toBe(3);
  });

  it("snoozing hides the row, closes the menu and shows the toast", () => {
    const open = inboxReducer(scene.initialState, {
      type: "openSnooze",
      id: "due",
    });
    expect(open.menuFor).toBe("due");
    const snoozed = inboxReducer(open, { type: "snooze", id: "due" });
    expect(snoozed).toMatchObject({ menuFor: null, toast: true });
    expect(visibleItems(snoozed).map((item) => item.id)).not.toContain("due");
  });

  it("mark all read clears the count", () => {
    expect(
      unreadCount(inboxReducer(scene.initialState, { type: "markAllRead" })),
    ).toBe(0);
  });

  it("ends with the assignment snoozed and the mention read", () => {
    const final = finalStateOf(scene);
    const ids = visibleItems(final).map((item) => item.id);
    expect(ids).not.toContain(SNOOZED_ID);
    expect(ids).toHaveLength(4);
    expect(final.items.find((item) => item.id === READ_ID)?.unread).toBe(false);
    expect(unreadCount(final)).toBe(1);
    expect(final.toast).toBe(true);
  });
});
