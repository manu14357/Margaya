import type { AskSource } from "@/fetchers/ai/ask";
import { parseAskChart } from "./ask-blocks";

// Citation tokens in Ask answers: [T:WEB-12] (task), [P:<page title>] (page),
// [C:WEB-12/ab12cd] (comment) and [W:1] (a web search result). The API lists
// what an answer may cite; tokens that match none stay plain text, so an
// invented one never links.

// The match includes a space left between a citation and the punctuation
// after it ("[T:WEB-6] , so"): a linked citation drops it, so the comma sits
// right after the chip. Unknown tokens keep their text as written.
const CITATION_RULE = /\[([TPCW]):([^\]\n]{1,100})\](?:[ \t]+(?=[,.;:!?)…]))?/g;

export const CITE_HREF_PREFIX = "#ask-cite-";

// Context blocks that aren't citable sources. Models sometimes cite them
// anyway ("[facts:counts Website Relaunch]", "[file:notes.txt]"): computed
// facts and memory notes disappear, an attachment reads as its file name.
const INTERNAL_REF = /[ \t]?\[(?:facts|memory|notes?)[:\s][^\]\n]{0,160}\]/gi;
const FILE_REF = /\[file:([^\]\n]{1,160})\]/gi;

/** The answer without references to facts, memory notes or attachments. */
export function withoutInternalRefs(text: string): string {
  return text
    .replace(INTERNAL_REF, "")
    .replace(FILE_REF, (_token, name: string) => `(${name.trim()})`);
}

/** The short label a chip shows: the task key, page title or comment's task. */
export function citationLabel(source: AskSource): string {
  const value = source.ref.slice(2);
  if (source.kind === "comment") return value.split("/")[0] ?? value;
  if (source.kind === "web") {
    try {
      return new URL(source.url).hostname.replace(/^www\./, "");
    } catch {
      return value;
    }
  }
  if (source.kind === "page") {
    return value.length > 32 ? `${value.slice(0, 31)}…` : value;
  }
  return value;
}

/**
 * The answer as Markdown with known citations turned into links to
 * `#ask-cite-<n>`, where n indexes `cited`. The renderer draws those links
 * as chips. Pass `cited` to number several pieces of one answer together.
 */
export function linkCitations(
  text: string,
  sources: ReadonlyMap<string, AskSource>,
  cited: AskSource[] = [],
): { markdown: string; cited: AskSource[] } {
  const clean = withoutInternalRefs(text);
  const markdown = clean.replace(CITATION_RULE, (token, kind, value) => {
    const source = sources.get(`${kind}:${String(value).trim()}`);
    if (!source) return token;
    let index = cited.indexOf(source);
    if (index < 0) {
      cited.push(source);
      index = cited.length - 1;
    }
    const label = citationLabel(source).replace(/[[\]\\]/g, "");
    return `[${label}](${CITE_HREF_PREFIX}${index})`;
  });
  return { markdown, cited };
}

/** The refs an answer cites that match a source, in order of first use. */
export function citedSources(
  text: string,
  sources: ReadonlyMap<string, AskSource>,
): AskSource[] {
  return linkCitations(text, sources).cited;
}

const CHART_BLOCK =
  /^ {0,3}```chart[ \t]*\r?\n([\s\S]*?)\r?\n {0,3}```[ \t]*$/gm;

/** ```chart blocks as plain lists: the title, then "- label: value unit". */
export function chartsAsText(text: string): string {
  return text.replace(CHART_BLOCK, (block, json: string) => {
    const chart = parseAskChart(json);
    if (!chart) return block;
    const unit = chart.unit ? ` ${chart.unit}` : "";
    const series = chart.series;
    return [
      ...(chart.title ? [chart.title] : []),
      ...chart.data.map((point, index) =>
        series
          ? `- ${point.label}: ${series
              .map((item) => `${item.name} ${item.values[index] ?? 0}${unit}`)
              .join(", ")}`
          : `- ${point.label}: ${point.value}${unit}`,
      ),
    ].join("\n");
  });
}

/**
 * The answer as Markdown for a page or "Copy as Markdown": citations become
 * links (full URLs) and charts plain lists.
 */
export function answerAsMarkdown(
  text: string,
  sources: ReadonlyMap<string, AskSource>,
  origin: string,
): string {
  return withoutInternalRefs(chartsAsText(text))
    .replace(CITATION_RULE, (token, kind, value) => {
      const source = sources.get(`${kind}:${String(value).trim()}`);
      if (!source) return token;
      const label = citationLabel(source).replace(/[[\]\\]/g, "");
      const url = source.kind === "web" ? source.url : `${origin}${source.url}`;
      return `[${label}](${url})`;
    })
    .trim();
}

/**
 * The answer for the clipboard: charts become plain lists and tokens plain
 * labels, followed by a list of the cited sources with full links.
 */
export function answerForCopy(
  text: string,
  sources: ReadonlyMap<string, AskSource>,
  origin: string,
  heading: string,
): string {
  const cited: AskSource[] = [];
  const body = withoutInternalRefs(chartsAsText(text)).replace(
    CITATION_RULE,
    (token, kind, value) => {
      const source = sources.get(`${kind}:${String(value).trim()}`);
      if (!source) return token;
      if (!cited.includes(source)) cited.push(source);
      return `[${citationLabel(source)}]`;
    },
  );
  if (cited.length === 0) return body.trim();
  const list = cited
    .map(
      (source) =>
        `- ${source.title}: ${source.kind === "web" ? "" : origin}${source.url}`,
    )
    .join("\n");
  return `${body.trim()}\n\n${heading}:\n${list}`;
}
