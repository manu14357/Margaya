/**
 * The tiny, safe text format of saved offline copies: plain text where a
 * line may start with a heading ("# "), a list item ("- ", "1. ") or a
 * checklist item ("- [ ] ", "- [x] "). Everything else is a paragraph whose
 * line breaks are kept. The result is rendered as React text only.
 */
export type OfflineBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "item"; marker: string; checked: boolean | null; text: string }
  | { type: "paragraph"; lines: string[] };

const HEADING = /^(#{1,6})\s+(.*)$/;
const CHECK = /^[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const BULLET = /^[-*+]\s+(.*)$/;
const NUMBERED = /^(\d{1,9}[.)])\s+(.*)$/;

export function parseOfflineText(text: string): OfflineBlock[] {
  const blocks: OfflineBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0)
      blocks.push({ type: "paragraph", lines: paragraph });
    paragraph = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const trimmed = line.trimStart();
    if (!trimmed) {
      flush();
      continue;
    }
    const heading = HEADING.exec(trimmed);
    if (heading) {
      flush();
      const level = Math.min((heading[1] ?? "#").length, 3) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, text: heading[2] ?? "" });
      continue;
    }
    const check = CHECK.exec(trimmed);
    if (check) {
      flush();
      blocks.push({
        type: "item",
        marker: "",
        checked: check[1] !== " ",
        text: check[2] ?? "",
      });
      continue;
    }
    const bullet = BULLET.exec(trimmed);
    if (bullet) {
      flush();
      blocks.push({
        type: "item",
        marker: "•",
        checked: null,
        text: bullet[1] ?? "",
      });
      continue;
    }
    const numbered = NUMBERED.exec(trimmed);
    if (numbered) {
      flush();
      blocks.push({
        type: "item",
        marker: numbered[1] ?? "",
        checked: null,
        text: numbered[2] ?? "",
      });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}
