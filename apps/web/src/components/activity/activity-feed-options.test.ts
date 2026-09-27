import { describe, expect, it } from "vitest";
import {
  arrangeActivities,
  EDITED_THRESHOLD_MS,
  isCommentEdited,
} from "./activity-feed-options";

// As the API sends them: newest first.
const feed = [
  {
    id: "c2",
    type: "comment",
    content: "Second",
    createdAt: "2026-10-03T10:00:00Z",
  },
  {
    id: "s1",
    type: "status_changed",
    content: null,
    createdAt: "2026-10-02T10:00:00Z",
  },
  {
    id: "c1",
    type: "comment",
    content: "First",
    createdAt: "2026-10-01T10:00:00Z",
  },
  {
    id: "x0",
    type: "created",
    content: "created",
    createdAt: "2026-09-30T10:00:00Z",
  },
];

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe("arrangeActivities", () => {
  it("keeps everything, newest first, by default", () => {
    expect(ids(arrangeActivities(feed, "all", "newest"))).toEqual([
      "c2",
      "s1",
      "c1",
      "x0",
    ]);
  });

  it("puts the oldest first on request", () => {
    expect(ids(arrangeActivities(feed, "all", "oldest"))).toEqual([
      "x0",
      "c1",
      "s1",
      "c2",
    ]);
  });

  it("shows only comments or only updates", () => {
    expect(ids(arrangeActivities(feed, "comments", "newest"))).toEqual([
      "c2",
      "c1",
    ]);
    expect(ids(arrangeActivities(feed, "updates", "oldest"))).toEqual([
      "x0",
      "s1",
    ]);
  });

  it("counts an empty comment row as an update, as the feed renders it", () => {
    const rows = [
      {
        id: "e",
        type: "comment",
        content: "",
        createdAt: "2026-10-01T10:00:00Z",
      },
    ];
    expect(arrangeActivities(rows, "comments", "newest")).toEqual([]);
    expect(ids(arrangeActivities(rows, "updates", "newest"))).toEqual(["e"]);
  });

  it("keeps the API order for rows at the same time", () => {
    const at = "2026-10-01T10:00:00Z";
    const rows = [
      { id: "a", type: "label_added", content: null, createdAt: at },
      { id: "b", type: "label_added", content: null, createdAt: at },
    ];
    expect(ids(arrangeActivities(rows, "all", "newest"))).toEqual(["a", "b"]);
    expect(ids(arrangeActivities(rows, "all", "oldest"))).toEqual(["a", "b"]);
  });

  it("does not change the list it is given", () => {
    const copy = [...feed];
    arrangeActivities(feed, "all", "oldest");
    expect(feed).toEqual(copy);
  });
});

describe("isCommentEdited", () => {
  const created = "2026-10-01T10:00:00.000Z";
  const later = (ms: number) =>
    new Date(Date.parse(created) + ms).toISOString();

  it("ignores saves within the first minute", () => {
    expect(isCommentEdited(created, created)).toBe(false);
    expect(isCommentEdited(created, later(30_000))).toBe(false);
    expect(isCommentEdited(created, later(EDITED_THRESHOLD_MS))).toBe(false);
  });

  it("marks later edits", () => {
    expect(isCommentEdited(created, later(EDITED_THRESHOLD_MS + 1))).toBe(true);
    expect(isCommentEdited(created, later(3_600_000))).toBe(true);
  });

  it("is false without both times", () => {
    expect(isCommentEdited(created, undefined)).toBe(false);
    expect(isCommentEdited(undefined, later(3_600_000))).toBe(false);
    expect(isCommentEdited(created, "not a date")).toBe(false);
  });
});
