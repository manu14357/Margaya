import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** One highlighted run of a line, as a highlighter reports it. */
export type LineToken = {
  content: string;
  color?: string;
  /** Bit flags: 1 italic, 2 bold, 4 underline. */
  fontStyle?: number;
};

export type LineHit = { line: number; start: number; end: number };

const LINE_HEIGHT = 20;
const OVERSCAN = 12;
const MAX_HITS = 10_000;

export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  // A trailing newline doesn't start another line worth numbering.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Case-insensitive matches of `query`, at most 10,000. */
export function findInLines(lines: string[], query: string): LineHit[] {
  const needle = query.toLocaleLowerCase();
  if (!needle) return [];
  const hits: LineHit[] = [];
  for (let line = 0; line < lines.length; line += 1) {
    const haystack = (lines[line] ?? "").toLocaleLowerCase();
    let from = 0;
    while (true) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      hits.push({ line, start: at, end: at + needle.length });
      if (hits.length >= MAX_HITS) return hits;
      from = at + Math.max(needle.length, 1);
    }
  }
  return hits;
}

function tokenStyle(token: LineToken): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (token.color) style.color = token.color;
  const flags = token.fontStyle ?? 0;
  if (flags & 1) style.fontStyle = "italic";
  if (flags & 2) style.fontWeight = 600;
  if (flags & 4) style.textDecoration = "underline";
  return token.color || flags ? style : undefined;
}

/**
 * A line's text as runs: the highlighter's tokens, cut wherever a find
 * match starts or ends so the match can be marked.
 */
export function renderLine(
  text: string,
  tokens: LineToken[] | undefined,
  marks: Array<{ start: number; end: number; current: boolean }>,
): ReactNode[] {
  const runs: LineToken[] = tokens?.length ? tokens : [{ content: text }];
  const out: ReactNode[] = [];
  let position = 0;
  let markIndex = 0;
  let key = 0;
  for (const run of runs) {
    let offset = 0;
    while (offset < run.content.length) {
      const absolute = position + offset;
      let mark = marks[markIndex];
      while (mark && mark.end <= absolute) {
        markIndex += 1;
        mark = marks[markIndex];
      }
      // The mark covering this position, if any, else the next one.
      const inside = mark && mark.start <= absolute ? mark : null;
      const boundary = inside
        ? inside.end
        : (mark?.start ?? Number.POSITIVE_INFINITY);
      const length = Math.min(run.content.length - offset, boundary - absolute);
      const piece = run.content.slice(offset, offset + length);
      const style = tokenStyle(run);
      const span = (
        <span key={key++} style={style}>
          {piece}
        </span>
      );
      out.push(
        inside ? (
          <mark
            key={key++}
            className={inside.current ? "mfp-hit mfp-hit-current" : "mfp-hit"}
          >
            {span}
          </mark>
        ) : (
          span
        ),
      );
      offset += length;
    }
    position += run.content.length;
  }
  return out;
}

/**
 * Read-only, numbered, virtualised lines: only the rows in view are in the
 * DOM, so a 100,000-line log scrolls like a short one.
 */
export function LineView({
  lines,
  tokens,
  label,
  hits = [],
  current = -1,
  foreground,
  background,
}: {
  lines: string[];
  tokens?: LineToken[][] | null;
  label: string;
  hits?: LineHit[];
  current?: number;
  /** Theme colours from the highlighter, when it has them. */
  foreground?: string;
  background?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const [charWidth, setCharWidth] = useState(8);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setViewport(element.clientHeight || 600);
    measure();
    const width = measureRef.current?.getBoundingClientRect().width;
    if (width) setCharWidth(width / 10);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const longest = useMemo(() => {
    let max = 0;
    for (const line of lines) {
      // Tabs are four columns wide (tab-size below).
      let width = line.length;
      for (let i = 0; i < line.length; i += 1) {
        if (line.charCodeAt(i) === 9) width += 3;
      }
      if (width > max) max = width;
    }
    return max;
  }, [lines]);

  const gutter = String(lines.length).length + 2;

  const marksByLine = useMemo(() => {
    const map = new Map<
      number,
      Array<{ start: number; end: number; current: boolean }>
    >();
    hits.forEach((hit, index) => {
      const list = map.get(hit.line) ?? [];
      list.push({ start: hit.start, end: hit.end, current: index === current });
      map.set(hit.line, list);
    });
    return map;
  }, [hits, current]);

  // Bring the current match into view, centred when it was off screen.
  useEffect(() => {
    const hit = hits[current];
    const element = scrollRef.current;
    if (!hit || !element) return;
    const top = hit.line * LINE_HEIGHT;
    if (
      top < element.scrollTop ||
      top + LINE_HEIGHT > element.scrollTop + element.clientHeight
    ) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 2);
    }
    const left = (gutter + hit.start) * charWidth;
    const gutterWidth = gutter * charWidth;
    if (
      left < element.scrollLeft + gutterWidth ||
      left > element.scrollLeft + element.clientWidth - 40
    ) {
      element.scrollLeft = Math.max(0, left - element.clientWidth / 2);
    }
  }, [hits, current, gutter, charWidth]);

  const first = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const last = Math.min(
    lines.length,
    Math.ceil((scrollTop + viewport) / LINE_HEIGHT) + OVERSCAN,
  );
  const rows: ReactNode[] = [];
  for (let index = first; index < last; index += 1) {
    rows.push(
      <div
        key={index}
        className="mfp-line"
        style={{ top: index * LINE_HEIGHT, height: LINE_HEIGHT }}
      >
        <span
          className="mfp-line-number"
          style={{ width: `${gutter}ch` }}
          aria-hidden="true"
        >
          {index + 1}
        </span>
        <span className="mfp-line-text">
          {renderLine(
            lines[index] ?? "",
            tokens?.[index],
            marksByLine.get(index) ?? [],
          )}
        </span>
      </div>,
    );
  }

  return (
    <section
      ref={scrollRef}
      className="mfp-lines mfp-scroll"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable read-only region is reached and scrolled from the keyboard
      tabIndex={0}
      aria-label={label}
      style={{
        color: foreground,
        background,
      }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <span ref={measureRef} className="mfp-line-measure" aria-hidden="true">
        0000000000
      </span>
      <div
        className="mfp-lines-inner"
        style={{
          height: lines.length * LINE_HEIGHT,
          width: `calc(${gutter + longest + 4}ch)`,
        }}
      >
        {rows}
      </div>
    </section>
  );
}
