import { type SQL, sql } from "drizzle-orm";
import { escapeLikePattern } from "./like-pattern";

// Full-text search building blocks shared by global search, page search,
// planning search and `searchWorkspace`.
//
// Every search runs against the `margaya_search` text search configuration
// (migration 0032): a copy of `simple`, plus `unaccent` when the extension
// could be created. Margaya has 20 UI languages and no per-row content
// language, so a stemming config would index one workspace's text with the
// wrong language's rules; `simple` lowercases and splits on word boundaries
// for every script and loses nothing. Prefix matching on the last word makes
// up for most of what stemming would add while typing.

/** The text search configuration every tsvector and tsquery uses. */
export const SEARCH_CONFIG = "margaya_search";

// Scripts written without spaces between words. The default parser reads a
// run of them as one token, so "タワー" never matches "東京タワーに行きました"
// through the index; such queries also match by substring.
const NO_SPACE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

export type TextQuery = {
  /** The query as typed, trimmed. */
  raw: string;
  /** A tsquery expression; false-y matches when the query has no lexemes. */
  tsquery: SQL;
  /** True when no word character is present: only `substring` can match. */
  noLexemes: boolean;
  /** An escaped `%…%` ILIKE pattern for scripts without spaces, else null. */
  substring: string | null;
};

/**
 * The last word, as a prefix (`'word':*`), when the query ends in the middle
 * of one: "login bu" finds "bug". A quoted phrase, a negation (`-word`) or an
 * `or` is left to `websearch_to_tsquery`. The word keeps letters, digits,
 * marks, `_` and `-` only, so it can never close the quoted lexeme.
 */
function splitPrefix(raw: string): { head: string; prefix: string | null } {
  const lastChar = Array.from(raw).at(-1) ?? "";
  if (!WORD_CHAR.test(lastChar)) return { head: raw, prefix: null };
  const match = raw.match(/(^|\s)([^\s]+)$/u);
  const word = match?.[2] ?? "";
  if (!word || word.startsWith("-") || word.toLowerCase() === "or") {
    return { head: raw, prefix: null };
  }
  // An unclosed quote means the last word belongs to a phrase.
  if ((raw.match(/"/g)?.length ?? 0) % 2 === 1) {
    return { head: raw, prefix: null };
  }
  const cleaned = word.replace(/[^\p{L}\p{N}\p{M}_-]/gu, "");
  if (!cleaned || !WORD_CHAR.test(cleaned)) return { head: raw, prefix: null };
  return { head: raw.slice(0, raw.length - word.length), prefix: cleaned };
}

/**
 * Splits the text before the prefix word at its last `or` operator, so the
 * prefix joins the right group: `websearch_to_tsquery` binds `or` looser
 * than the implicit AND ("a b or c" is `(a & b) | c`). Like Postgres, an
 * `or` counts as an operator only outside quotes, after a term, and not
 * right after another `or`; a trailing `or` here always has the prefix word
 * as its right operand.
 */
function splitLastOr(head: string): { left: string; group: string } {
  let quotes = 0;
  let previousWasOr = false;
  let lastOr: { start: number; end: number } | null = null;
  for (const token of head.matchAll(/\S+/gu)) {
    const text = token[0];
    const start = token.index ?? 0;
    const isOr: boolean =
      quotes % 2 === 0 &&
      text.toLowerCase() === "or" &&
      start > 0 &&
      head.slice(0, start).trim() !== "" &&
      !previousWasOr;
    if (isOr) lastOr = { start, end: start + text.length };
    previousWasOr = isOr;
    quotes += text.match(/"/g)?.length ?? 0;
  }
  if (!lastOr) return { left: "", group: head };
  return {
    left: head.slice(0, lastOr.start),
    group: head.slice(lastOr.end),
  };
}

/**
 * Parses a user query into a ranked full-text query: `websearch_to_tsquery`
 * semantics ("quoted phrases", `or`, `-exclusions`) with the last word as a
 * prefix for as-you-type search.
 */
export function parseTextQuery(query: string): TextQuery {
  const raw = query.normalize("NFKC").trim();
  const noLexemes = !WORD_CHAR.test(raw);
  const { head, prefix } = splitPrefix(raw);
  const config = sql.raw(`'${SEARCH_CONFIG}'`);
  const websearch = (text: string) =>
    text.trim()
      ? sql`websearch_to_tsquery(${config}::regconfig, ${text})`
      : null;
  let tsquery: SQL;
  if (prefix) {
    const prefixQuery = sql`to_tsquery(${config}::regconfig, ${`'${prefix}':*`})`;
    const { left, group } = splitLastOr(head);
    const groupQuery = websearch(group);
    const lastGroup = groupQuery
      ? sql`(${groupQuery} && ${prefixQuery})`
      : prefixQuery;
    const leftQuery = websearch(left);
    tsquery = leftQuery ? sql`(${leftQuery} || ${lastGroup})` : lastGroup;
  } else {
    tsquery = websearch(head) ?? sql`''::tsquery`;
  }
  const substring =
    noLexemes || NO_SPACE_SCRIPT.test(raw)
      ? `%${escapeLikePattern(raw)}%`
      : null;
  return { raw, tsquery, noLexemes, substring };
}

/** `to_tsvector` over arbitrary text, for small tables without a column. */
export function tsvectorOf(text: SQL): SQL {
  return sql`to_tsvector(${sql.raw(`'${SEARCH_CONFIG}'`)}::regconfig, ${text})`;
}

/**
 * Rank in [0, 1): `ts_rank` with length normalization (1) and `rank/(rank+1)`
 * scaling (32), so a tier added on top (title 3, body 2) is never overtaken.
 */
export function rankOf(tsv: SQL, query: TextQuery): SQL<number> {
  return sql<number>`ts_rank(${tsv}, ${query.tsquery}, 33)::float8`;
}

// Private-use characters mark highlights inside `ts_headline` output; they
// are stripped from the source text first, so every pair is ours.
const HIGHLIGHT_START = "\uE000";
const HIGHLIGHT_STOP = "\uE001";

/** Longest body text a snippet is cut from, to bound `ts_headline` work. */
const SNIPPET_SOURCE_LIMIT = 20_000;

/**
 * A `ts_headline` snippet of `text` around the query's matches, up to two
 * fragments of about 8 to 24 words. Postgres evaluates it after the LIMIT,
 * so only the returned rows pay for it.
 */
export function headlineOf(text: SQL, query: TextQuery): SQL<string | null> {
  return sql<string | null>`nullif(ts_headline(
    ${sql.raw(`'${SEARCH_CONFIG}'`)}::regconfig,
    translate(left(coalesce(${text}, ''), ${SNIPPET_SOURCE_LIMIT}), ${`${HIGHLIGHT_START}${HIGHLIGHT_STOP}`}, ''),
    ${query.tsquery},
    ${`StartSel=${HIGHLIGHT_START}, StopSel=${HIGHLIGHT_STOP}, MaxWords=24, MinWords=8, ShortWord=2, MaxFragments=2, FragmentDelimiter=" … "`}
  ), '')`;
}

export type SearchSnippet = {
  text: string;
  /** Highlighted spans as [start, end) offsets in UTF-16 code units. */
  highlights: Array<{ start: number; end: number }>;
};

// Markdown syntax that reads as noise in a one-line snippet. Links keep
// their text. Applied before the markers are parsed, so offsets stay right.
function stripMarkdown(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(^|\s)(#{1,6}|>|[-*+]\s\[[ xX]\])\s+/g, "$1")
    .replace(/\*\*|__|~~|`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Turns `ts_headline` output into plain text plus highlight ranges. */
export function parseHeadline(
  headline: string | null | undefined,
): SearchSnippet | undefined {
  if (!headline) return undefined;
  const source = stripMarkdown(headline);
  let text = "";
  const highlights: SearchSnippet["highlights"] = [];
  let openAt = -1;
  for (const char of source) {
    if (char === HIGHLIGHT_START) {
      openAt = text.length;
    } else if (char === HIGHLIGHT_STOP) {
      if (openAt >= 0 && text.length > openAt) {
        highlights.push({ start: openAt, end: text.length });
      }
      openAt = -1;
    } else {
      text += char;
    }
  }
  if (!text) return undefined;
  return { text, highlights };
}

/**
 * The match condition for an indexed tsvector column that the boot backfill
 * may not have reached yet. `pending` recomputes the vector for rows still
 * NULL; the partial "pending" index lets Postgres find those without a
 * sequential scan, and it is empty once the backfill is done.
 */
export function indexedMatch(
  column: SQL,
  pending: SQL,
  query: TextQuery,
  substringOn: SQL[] = [],
): SQL {
  const arms: SQL[] = [];
  if (!query.noLexemes) {
    arms.push(sql`${column} @@ ${query.tsquery}`);
    arms.push(sql`(${column} is null and ${pending} @@ ${query.tsquery})`);
  }
  if (query.substring) {
    for (const text of substringOn) {
      arms.push(sql`${text} ilike ${query.substring}`);
    }
  }
  if (arms.length === 0) return sql`false`;
  return sql`(${sql.join(arms, sql` or `)})`;
}

/** The same for text without a stored vector (small tables). */
export function computedMatch(
  texts: SQL[],
  query: TextQuery,
  substringOn: SQL[] = texts,
): SQL {
  const arms: SQL[] = [];
  if (!query.noLexemes) {
    const document = sql.join(
      texts.map((text) => sql`coalesce(${text}, '')`),
      sql` || ' ' || `,
    );
    arms.push(sql`${tsvectorOf(document)} @@ ${query.tsquery}`);
  }
  if (query.substring) {
    for (const text of substringOn) {
      arms.push(sql`${text} ilike ${query.substring}`);
    }
  }
  if (arms.length === 0) return sql`false`;
  return sql`(${sql.join(arms, sql` or `)})`;
}

/**
 * Relevance for a row whose title (and, for tasks, key) carries weight A in
 * `tsv`: 3 when the whole query matches the title, else 2, plus the rank.
 * Substring-only matches (scripts without spaces) score by where they hit.
 */
export function tieredScore(
  tsv: SQL,
  title: SQL,
  query: TextQuery,
  options: { titleWeighted: boolean },
): SQL<number> {
  const titleHit = options.titleWeighted
    ? sql`ts_filter(${tsv}, '{a}') @@ ${query.tsquery}`
    : sql`${tsvectorOf(sql`coalesce(${title}, '')`)} @@ ${query.tsquery}`;
  const substringTitleHit = query.substring
    ? sql` or ${title} ilike ${query.substring}`
    : sql``;
  if (query.noLexemes) {
    return sql<number>`(case when ${title} ilike ${query.substring ?? ""} then 3 else 2 end)::float8`;
  }
  return sql<number>`((case when ${titleHit}${substringTitleHit} then 3 else 2 end) + coalesce(${rankOf(tsv, query)}, 0))::float8`;
}
