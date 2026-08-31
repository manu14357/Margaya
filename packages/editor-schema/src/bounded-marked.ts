import { Marked, type MarkedExtension, type TokenizerExtension } from "marked";

// marked tries every extension block tokenizer at every block position, and
// some editor extensions look at the whole remaining source each time (the
// ordered list tokenizer splits it into lines; the table and task list start
// probes scan it). Parsing then grows with the square of the block count,
// so a 1 MiB body of short paragraphs would block the server for minutes.
//
// These wrappers hand each extension only the part of the source its
// construct can cover. Results are unchanged: a construct never extends
// past its window.

const LIST_MARKER = /^ {0,3}(?:(\d{1,9})[.)]|[-+*])(?:[ \t]|$)/;

function lineEnd(src: string, from: number): number {
  const index = src.indexOf("\n", from);
  return index === -1 ? src.length : index + 1;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function listKind(line: string): "ordered" | "bullet" | null {
  const match = LIST_MARKER.exec(line);
  if (!match) return null;
  return match[1] === undefined ? "bullet" : "ordered";
}

/** Up to and including the first blank line (a paragraph, a table). */
export function paragraphWindow(src: string): string {
  let position = 0;
  while (position < src.length) {
    const end = lineEnd(src, position);
    if (isBlank(src.slice(position, end))) return src.slice(0, end);
    position = end;
  }
  return src;
}

/**
 * The source a block construct starting here can cover: a paragraph or a
 * table ends at a blank line; a list continues over blank lines, indented
 * lines, lazy continuation lines and items of the same kind (ordered or
 * bullet), and ends at any other line.
 */
export function blockWindow(src: string): string {
  const firstEnd = lineEnd(src, 0);
  const kind = listKind(src.slice(0, firstEnd));
  if (!kind) return paragraphWindow(src);

  let position = firstEnd;
  let afterBlank = false;
  while (position < src.length) {
    const end = lineEnd(src, position);
    const line = src.slice(position, end);
    if (isBlank(line)) {
      afterBlank = true;
    } else if (/^[ \t]/.test(line)) {
      afterBlank = false;
    } else {
      const lineKind = listKind(line);
      if (lineKind !== null ? lineKind !== kind : afterBlank) break;
      afterBlank = false;
    }
    position = end;
  }
  return src.slice(0, position);
}

function boundBlockExtension(
  extension: NonNullable<MarkedExtension["extensions"]>[number],
): NonNullable<MarkedExtension["extensions"]>[number] {
  if (!("level" in extension) || extension.level !== "block") return extension;
  const tokenizerExtension = extension as TokenizerExtension;
  const { start, tokenizer } = tokenizerExtension;
  return {
    ...tokenizerExtension,
    start: start
      ? function (this: unknown, src: string) {
          return start.call(this as never, paragraphWindow(src));
        }
      : undefined,
    tokenizer(this: unknown, src, tokens) {
      return tokenizer.call(this as never, blockWindow(src), tokens);
    },
  } as TokenizerExtension;
}

/** A private marked instance whose extension block tokenizers are bounded. */
export function createBoundedMarked(): Marked {
  const instance = new Marked();
  const use = instance.use.bind(instance);
  instance.use = (...extensions: MarkedExtension[]) =>
    use(
      ...extensions.map((extension) =>
        extension.extensions
          ? {
              ...extension,
              extensions: extension.extensions.map(boundBlockExtension),
            }
          : extension,
      ),
    );
  return instance;
}
