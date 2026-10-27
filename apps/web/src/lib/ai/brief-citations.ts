// Stakeholder briefs cite tasks as [WEB-12]. These turn the markers the
// brief may cite into links; unknown keys stay plain text, so a key the
// model made up never becomes a link.

type Citation = { key: string; url: string };

const MARKER = /\[([\p{L}\p{N}_]+-\d+)\](?!\()/gu;

/** `[WEB-12]` → `[WEB-12](url)` for cited keys; `base` makes them absolute. */
export function linkCitations(
  text: string,
  citations: readonly Citation[],
  base = "",
): string {
  const urls = new Map(
    citations.map((citation) => [citation.key.toUpperCase(), citation.url]),
  );
  return text.replace(MARKER, (marker, key: string) => {
    const url = urls.get(key.toUpperCase());
    return url ? `[${key}](${base}${url})` : marker;
  });
}

/** The keys the text cites that are not among the citations. */
export function unknownCitations(
  text: string,
  citations: readonly Citation[],
): string[] {
  const known = new Set(citations.map((c) => c.key.toUpperCase()));
  const unknown = new Set<string>();
  for (const match of text.matchAll(MARKER)) {
    const key = (match[1] ?? "").toUpperCase();
    if (key && !known.has(key)) unknown.add(key);
  }
  return [...unknown];
}
