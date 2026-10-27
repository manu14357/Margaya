import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  parseHeadline,
  parseTextQuery,
} from "../../../apps/api/src/search/text-query";

const dialect = new PgDialect();
const render = (query: SQL) => dialect.sqlToQuery(query);

describe("parseTextQuery", () => {
  it("matches the last word as a prefix and the rest with web-search syntax", () => {
    const { sql, params } = render(parseTextQuery("login bu").tsquery);
    expect(sql).toContain("websearch_to_tsquery('margaya_search'::regconfig");
    expect(sql).toContain("to_tsquery('margaya_search'::regconfig");
    expect(params).toEqual(["login ", "'bu':*"]);
  });

  it("uses only a prefix for a single word", () => {
    const { sql, params } = render(parseTextQuery("  Rocket ").tsquery);
    expect(sql).not.toContain("websearch_to_tsquery");
    expect(params).toEqual(["'Rocket':*"]);
  });

  it("leaves phrases, exclusions, `or` and trailing punctuation to websearch_to_tsquery", () => {
    for (const q of [
      '"exact phrase"',
      "login -bug",
      "a or",
      "100%",
      '"open phr',
    ]) {
      const { sql, params } = render(parseTextQuery(q).tsquery);
      expect(sql).not.toContain("to_tsquery('margaya_search'::regconfig, $2");
      expect(params).toEqual([q]);
    }
  });

  it("keeps `or` before a prefix word as an OR, not as a required word", () => {
    const { sql, params } = render(parseTextQuery("login or bu").tsquery);
    expect(sql).toMatch(/websearch_to_tsquery\([^)]*\$1\) \|\| to_tsquery/);
    expect(params).toEqual(["login ", "'bu':*"]);
  });

  it("binds `or` looser than the implicit AND, as websearch_to_tsquery does", () => {
    const left = render(parseTextQuery("a b OR c d").tsquery);
    expect(left.sql).toMatch(
      /websearch_to_tsquery\([^)]*\$1\) \|\| \(websearch_to_tsquery\([^)]*\$2\) && to_tsquery/,
    );
    expect(left.params).toEqual(["a b ", " c ", "'d':*"]);

    const last = render(parseTextQuery("a or b or c").tsquery);
    expect(last.params).toEqual(["a or b ", "'c':*"]);
  });

  it("treats `or` inside quotes, at the start or after another `or` as a word", () => {
    expect(render(parseTextQuery('"x or y" z').tsquery).params).toEqual([
      '"x or y" ',
      "'z':*",
    ]);
    expect(render(parseTextQuery("or b").tsquery).params).toEqual([
      "or ",
      "'b':*",
    ]);
    const doubled = render(parseTextQuery("a or or b").tsquery);
    expect(doubled.params).toEqual(["a ", " or ", "'b':*"]);
    expect(doubled.sql).toContain("||");
  });

  it("keeps an exclusion before the prefix word", () => {
    const { sql, params } = render(parseTextQuery("-bug or log").tsquery);
    expect(sql).toContain("||");
    expect(params).toEqual(["-bug ", "'log':*"]);
  });

  it("keeps quotes and tsquery operators out of the prefix lexeme", () => {
    const { params } = render(parseTextQuery("o'brien:*|x").tsquery);
    expect(params).toEqual(["'obrienx':*"]);
  });

  it("adds a substring pattern for scripts written without spaces", () => {
    expect(parseTextQuery("タワー").substring).toBe("%タワー%");
    expect(parseTextQuery("测试_1").substring).toBe("%测试\\_1%");
    expect(parseTextQuery("Привет мир").substring).toBeNull();
    expect(parseTextQuery("rocket").substring).toBeNull();
  });

  it("falls back to substring only when the query has no word characters", () => {
    const query = parseTextQuery("%%");
    expect(query.noLexemes).toBe(true);
    expect(query.substring).toBe("%\\%\\%%");
  });

  it("normalizes to NFKC so composed and decomposed text match alike", () => {
    expect(parseTextQuery("ＷＥＢ-１２").raw).toBe("WEB-12");
  });
});

describe("parseHeadline", () => {
  it("returns plain text with highlight ranges", () => {
    expect(
      parseHeadline("the \uE000rocket\uE001 launch \uE000plan\uE001"),
    ).toEqual({
      text: "the rocket launch plan",
      highlights: [
        { start: 4, end: 10 },
        { start: 18, end: 22 },
      ],
    });
  });

  it("strips markdown noise without shifting ranges", () => {
    expect(
      parseHeadline("## Notes **see** [the \uE000docs\uE001](https://x.y)"),
    ).toEqual({
      text: "Notes see the docs",
      highlights: [{ start: 14, end: 18 }],
    });
  });

  it("counts UTF-16 offsets for non-Latin text", () => {
    const parsed = parseHeadline("Привет \uE000мир\uE001 😀 \uE000東京\uE001");
    expect(parsed?.text).toBe("Привет мир 😀 東京");
    const [first, second] = parsed?.highlights ?? [];
    expect(parsed?.text.slice(first?.start, first?.end)).toBe("мир");
    expect(parsed?.text.slice(second?.start, second?.end)).toBe("東京");
  });

  it("returns undefined for empty output", () => {
    expect(parseHeadline(null)).toBeUndefined();
    expect(parseHeadline("")).toBeUndefined();
  });
});
