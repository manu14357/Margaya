import { describe, expect, it } from "vitest";
import {
  applyReactionToggle,
  formatReactionUsers,
  REACTIONS,
  type ReactionGroupLike,
} from "./reactions";

const me = { id: "me", name: "Mina", image: null };
const ana = { id: "ana", name: "Ana", image: null };

const t = (key: string, options?: Record<string, unknown>) => {
  switch (key) {
    case "activity:reactions.you":
      return "You";
    case "activity:reactions.namesMore":
      return `${options?.names} and ${options?.count} more`;
    case "activity:reactions.reactedWith":
      return `${options?.names} reacted with ${options?.label}`;
    case "activity:reactions.labels.heart":
      return "Heart";
    default:
      return key;
  }
};

describe("reaction set", () => {
  it("has the eight reactions in picker order", () => {
    expect(REACTIONS.map((reaction) => reaction.key)).toEqual([
      "thumbs_up",
      "thumbs_down",
      "smile",
      "boom",
      "confused",
      "heart",
      "airplane",
      "eyes",
    ]);
  });
});

describe("applyReactionToggle", () => {
  it("appends a new group", () => {
    const groups: ReactionGroupLike[] = [
      { emoji: "heart", count: 1, reacted: false, users: [ana] },
    ];
    expect(applyReactionToggle(groups, "eyes", me)).toEqual([
      groups[0],
      { emoji: "eyes", count: 1, reacted: true, users: [me] },
    ]);
  });

  it("drops a group when the last reaction is removed", () => {
    const groups: ReactionGroupLike[] = [
      { emoji: "heart", count: 1, reacted: true, users: [me] },
      { emoji: "eyes", count: 1, reacted: false, users: [ana] },
    ];
    expect(applyReactionToggle(groups, "heart", me)).toEqual([groups[1]]);
  });

  it("joins and leaves another user's group", () => {
    const groups: ReactionGroupLike[] = [
      { emoji: "heart", count: 1, reacted: false, users: [ana] },
    ];
    const joined = applyReactionToggle(groups, "heart", me);
    expect(joined).toEqual([
      { emoji: "heart", count: 2, reacted: true, users: [ana, me] },
    ]);
    expect(applyReactionToggle(joined, "heart", me)).toEqual(groups);
  });
});

describe("formatReactionUsers", () => {
  it("puts me first as You", () => {
    expect(
      formatReactionUsers(
        { emoji: "heart", count: 2, reacted: true, users: [ana, me] },
        "me",
        t,
      ),
    ).toBe("You, Ana reacted with Heart");
  });

  it("lists five names, then how many more", () => {
    const users = Array.from({ length: 10 }, (_, index) => ({
      id: `u${index}`,
      name: `User ${index}`,
      image: null,
    }));
    expect(
      formatReactionUsers(
        { emoji: "heart", count: 12, reacted: false, users },
        "me",
        t,
      ),
    ).toBe(
      "User 0, User 1, User 2, User 3, User 4 and 7 more reacted with Heart",
    );
  });
});
