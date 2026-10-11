import { describe, expect, it } from "vitest";
import { newlyMentionedIds } from "../../../apps/api/src/mention/diff";

const tag = (id: string) =>
  `<margaya-mention id="${id}" label="${id}"></margaya-mention>`;

describe("newly mentioned", () => {
  it("is new minus old minus the actor", () => {
    expect(
      newlyMentionedIds(
        `${tag("a")}`,
        `${tag("a")} ${tag("b")} ${tag("me")}`,
        "me",
      ),
    ).toEqual(["b"]);
  });

  it("counts every mention as new when there was no content", () => {
    expect(newlyMentionedIds(null, `${tag("a")} ${tag("b")}`, null)).toEqual([
      "a",
      "b",
    ]);
  });

  it("ignores duplicates and removed mentions", () => {
    expect(
      newlyMentionedIds(tag("a"), `${tag("b")} and ${tag("b")} again`, "x"),
    ).toEqual(["b"]);
    expect(
      newlyMentionedIds(`${tag("a")} ${tag("b")}`, tag("a"), null),
    ).toEqual([]);
  });

  it("never reports a self-mention", () => {
    expect(newlyMentionedIds("", tag("me"), "me")).toEqual([]);
  });
});
