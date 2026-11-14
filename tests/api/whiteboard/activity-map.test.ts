import { describe, expect, it } from "vitest";
import {
  BOARD_EDIT_WINDOW_MS,
  BOARD_HISTORY_ACTIONS,
  BOARD_LIFECYCLE_ACTIONS,
  boardLifecycleActions,
  editorsToRecord,
} from "../../../apps/api/src/whiteboard/activity-map";

describe("board lifecycle mapping", () => {
  it.each([
    ["whiteboard.created", {}, ["created"]],
    ["whiteboard.deleted", {}, ["trashed"]],
    ["whiteboard.restored", {}, ["restored"]],
    ["whiteboard.purged", {}, ["purged"]],
    ["whiteboard.updated", { change: "locked" }, ["locked"]],
    ["whiteboard.updated", { change: "unlocked" }, ["unlocked"]],
    ["whiteboard.updated", { change: "archived" }, ["archived"]],
    ["whiteboard.updated", { change: "unarchived" }, ["unarchived"]],
    ["whiteboard.updated", { change: "published" }, ["published"]],
    ["whiteboard.updated", { change: "unpublished" }, ["unpublished"]],
    [
      "whiteboard.updated",
      { change: "details", changed: ["title"] },
      ["renamed"],
    ],
    [
      "whiteboard.updated",
      { change: "details", changed: ["icon"] },
      ["icon_changed"],
    ],
    [
      "whiteboard.updated",
      { change: "details", changed: ["title", "icon"] },
      ["renamed", "icon_changed"],
    ],
  ])("%s %j → %j", (event, data, expected) => {
    expect(boardLifecycleActions(event, data)).toEqual(expected);
  });

  it("ignores content saves, unknown changes and other events", () => {
    expect(boardLifecycleActions("whiteboard.content_saved", {})).toEqual([]);
    expect(
      boardLifecycleActions("whiteboard.updated", { change: "moved" }),
    ).toEqual([]);
    expect(
      boardLifecycleActions("whiteboard.updated", { change: "details" }),
    ).toEqual([]);
    expect(boardLifecycleActions("page.published", {})).toEqual([]);
  });

  it("lists every lifecycle action but purged in the board history", () => {
    expect(BOARD_HISTORY_ACTIONS).toEqual([
      ...BOARD_LIFECYCLE_ACTIONS.filter((action) => action !== "purged"),
      "edited",
    ]);
  });
});

describe("edit throttle", () => {
  const now = new Date("2026-11-14T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("is ten minutes", () => {
    expect(BOARD_EDIT_WINDOW_MS).toBe(600_000);
  });

  it("records each contributor once and drops empty ids", () => {
    expect(
      editorsToRecord(["ben", "cara", "ben", null, "", 42], [], now),
    ).toEqual(["ben", "cara"]);
  });

  it("skips people with an edit less than ten minutes old", () => {
    const recent = [
      { actorId: "ben", createdAt: ago(9 * 60 * 1000 + 59_000) },
      { actorId: "cara", createdAt: ago(BOARD_EDIT_WINDOW_MS) },
      { actorId: "dan", createdAt: ago(BOARD_EDIT_WINDOW_MS + 1) },
    ];
    expect(editorsToRecord(["ben", "cara", "dan"], recent, now)).toEqual([
      "cara",
      "dan",
    ]);
  });

  it("is not fooled by an edit of someone else or of a deleted account", () => {
    const recent = [
      { actorId: "cara", createdAt: ago(1000) },
      { actorId: null, createdAt: ago(1000) },
    ];
    expect(editorsToRecord(["ben"], recent, now)).toEqual(["ben"]);
  });
});
