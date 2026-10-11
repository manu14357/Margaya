import { describe, expect, it } from "vitest";
import {
  groupReactions,
  groupTaskReactions,
  isReactionEmoji,
  MAX_REACTION_USERS,
  REACTION_EMOJI,
  type ReactionRow,
} from "../../../apps/api/src/reaction/emoji";

const base = new Date("2026-09-26T10:00:00.000Z").getTime();

function row(
  emoji: string,
  userId: string,
  second: number,
  commentId: string | null = null,
): ReactionRow {
  return {
    commentId,
    emoji,
    userId,
    name: userId.toUpperCase(),
    image: null,
    createdAt: new Date(base + second * 1000),
  };
}

describe("reaction allow-list", () => {
  it("holds the eight keys in picker order", () => {
    expect(REACTION_EMOJI).toEqual([
      "thumbs_up",
      "thumbs_down",
      "smile",
      "boom",
      "confused",
      "heart",
      "airplane",
      "eyes",
    ]);
    expect(isReactionEmoji("heart")).toBe(true);
    expect(isReactionEmoji("thumbsup")).toBe(false);
    expect(isReactionEmoji("👍")).toBe(false);
  });
});

describe("reaction groups", () => {
  it("orders groups by first use, ties by the allowed order", () => {
    const groups = groupReactions(
      [
        row("eyes", "a", 1),
        row("heart", "b", 2),
        row("thumbs_up", "c", 2),
        row("eyes", "b", 3),
      ],
      "b",
    );
    expect(groups.map((group) => group.emoji)).toEqual([
      "eyes",
      "thumbs_up",
      "heart",
    ]);
    expect(groups[0]).toMatchObject({ count: 2, reacted: true });
    expect(groups[0]?.users.map((user) => user.id)).toEqual(["a", "b"]);
    expect(groups[1]).toMatchObject({ count: 1, reacted: false });
  });

  it("caps users at ten, earliest first, but counts everyone", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row("smile", `u${String(i).padStart(2, "0")}`, i),
    );
    const [group] = groupReactions(rows, "u11");
    expect(group?.count).toBe(12);
    expect(group?.users).toHaveLength(MAX_REACTION_USERS);
    expect(group?.users[0]?.id).toBe("u00");
    expect(group?.reacted).toBe(true);
  });

  it("splits a task's rows into task and comment groups", () => {
    const result = groupTaskReactions(
      [
        row("boom", "a", 1),
        row("heart", "a", 2, "c1"),
        row("heart", "b", 3, "c1"),
      ],
      "a",
    );
    expect(result.task.map((group) => group.emoji)).toEqual(["boom"]);
    expect(result.comments).toEqual([
      {
        commentId: "c1",
        groups: [
          expect.objectContaining({ emoji: "heart", count: 2, reacted: true }),
        ],
      },
    ]);
  });
});
