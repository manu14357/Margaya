import { describe, expect, it } from "vitest";
import {
  findFavorite,
  moveFavorite,
  prependFavorite,
  removeFavoriteByEntity,
  replaceFavorite,
} from "./favorites";

const favorite = (id: string, position: number, entityId = `p-${id}`) => ({
  id,
  entityType: "project",
  entityId,
  position,
});

const list = [favorite("a", 0), favorite("b", 1), favorite("c", 2)];

describe("moveFavorite", () => {
  it("moves down and renumbers positions", () => {
    expect(moveFavorite(list, "a", "c")).toEqual([
      favorite("b", 0),
      favorite("c", 1),
      favorite("a", 2),
    ]);
  });

  it("moves up", () => {
    expect(moveFavorite(list, "c", "a").map((f) => f.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("leaves the order alone for unknown or identical ids", () => {
    expect(moveFavorite(list, "a", "a")).toEqual(list);
    expect(moveFavorite(list, "a", "zzz")).toEqual(list);
  });
});

describe("prependFavorite", () => {
  it("puts a new favorite above the current first", () => {
    const next = prependFavorite(list, favorite("new", 99, "p-new"));
    expect(next[0]).toEqual(favorite("new", -1, "p-new"));
    expect(next).toHaveLength(4);
  });

  it("starts at zero on an empty list", () => {
    expect(prependFavorite([], favorite("x", 5))[0]?.position).toBe(0);
  });

  it("never duplicates an entity", () => {
    const next = prependFavorite(list, favorite("dup", 0, "p-b"));
    expect(next.filter((f) => f.entityId === "p-b")).toHaveLength(1);
    expect(next[0]?.id).toBe("dup");
  });
});

describe("entity helpers", () => {
  it("finds and removes by entity", () => {
    expect(findFavorite(list, "project", "p-b")?.id).toBe("b");
    expect(findFavorite(list, "cycle", "p-b")).toBeUndefined();
    expect(
      removeFavoriteByEntity(list, "project", "p-b").map((f) => f.id),
    ).toEqual(["a", "c"]);
  });

  it("swaps a placeholder for the saved row", () => {
    const withPlaceholder = prependFavorite(list, favorite("temp", 0, "p-new"));
    const saved = favorite("real", -1, "p-new");
    expect(replaceFavorite(withPlaceholder, saved)[0]).toEqual(saved);
  });
});
