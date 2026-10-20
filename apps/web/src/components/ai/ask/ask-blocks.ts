// An Ask answer split into what the renderer draws differently: Markdown,
// ```chart blocks (JSON the API's instructions ask for) and GFM tables
// (react-markdown alone has no table syntax). Pure, so it runs on every
// streamed delta.

export const ASK_CHART_TYPES = ["bar", "donut", "line"] as const;
export type AskChartType = (typeof ASK_CHART_TYPES)[number];

export const MAX_CHART_POINTS = 30;
const MAX_LABEL_CHARS = 60;
const MAX_TITLE_CHARS = 120;

export type AskChartPoint = { label: string; value: number };

/** One named line or bar segment, aligned with the chart's `data` labels. */
export type AskChartSeries = { name: string; values: (number | null)[] };

export type AskChartSpec = {
  type: AskChartType;
  title: string;
  /**
   * The points. With `series`, each label once in first-seen order and the
   * value the sum of the series there (what a donut or a copy would show).
   */
  data: AskChartPoint[];
  unit: string | null;
  /** Two or more series ("created" vs "completed"); absent for one. */
  series?: AskChartSeries[];
};

export const MAX_CHART_SERIES = 5;

export type AskBlock =
  | { kind: "markdown"; text: string }
  /** `chart` is null while the block streams (`pending`) or when invalid. */
  | { kind: "chart"; chart: AskChartSpec | null; pending: boolean }
  | { kind: "table"; header: string[]; rows: string[][] };

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function readPoints(value: unknown): AskChartPoint[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0 || value.length > MAX_CHART_POINTS) return null;
  const data: AskChartPoint[] = [];
  for (const point of value) {
    if (!point || typeof point !== "object") return null;
    const { label, value: raw } = point as Record<string, unknown>;
    const name =
      typeof label === "number"
        ? String(label)
        : cleanText(label, MAX_LABEL_CHARS);
    const number = typeof raw === "string" && raw.trim() ? Number(raw) : raw;
    if (!name || typeof number !== "number" || !Number.isFinite(number)) {
      return null;
    }
    if (number < 0) return null;
    data.push({ label: name, value: number });
  }
  return data;
}

/**
 * Several series as aligned values over the union of their labels (first
 * seen first). A label a series lacks is null: a gap in a line, nothing in
 * a bar.
 */
function readSeries(
  value: unknown,
): { data: AskChartPoint[]; series: AskChartSeries[] } | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0 || value.length > MAX_CHART_SERIES) return null;
  const read: { name: string; points: AskChartPoint[] }[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object") return null;
    const entry = item as Record<string, unknown>;
    const points = readPoints(entry.data);
    if (!points) return null;
    read.push({
      name: cleanText(entry.name, MAX_LABEL_CHARS) ?? String(index + 1),
      points,
    });
  }
  const labels: string[] = [];
  for (const { points } of read) {
    for (const point of points) {
      if (!labels.includes(point.label)) labels.push(point.label);
    }
  }
  if (labels.length > MAX_CHART_POINTS) return null;
  const series = read.map(({ name, points }) => ({
    name,
    values: labels.map(
      (label) => points.find((point) => point.label === label)?.value ?? null,
    ),
  }));
  const data = labels.map((label, index) => ({
    label,
    value: series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0),
  }));
  return { data, series };
}

/**
 * The chart a ```chart block describes, or null when it isn't valid: JSON
 * with a known type and either 1 to 30 points of a label and a finite number
 * of zero or more (`data`), or 1 to 5 named series of such points
 * (`series`). Never throws.
 */
export function parseAskChart(source: string): AskChartSpec | null {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const spec = value as Record<string, unknown>;
  const type = spec.type === "pie" ? "donut" : spec.type;
  if (!(ASK_CHART_TYPES as readonly unknown[]).includes(type)) return null;
  const base = {
    type: type as AskChartType,
    title: cleanText(spec.title, MAX_TITLE_CHARS) ?? "",
    unit: cleanText(spec.unit, 30),
  };
  if (spec.series !== undefined && spec.data === undefined) {
    const multi = readSeries(spec.series);
    if (!multi) return null;
    // One series, or a donut (slices of one whole), reads as plain data.
    if (multi.series.length === 1 || base.type === "donut") {
      const first = multi.series[0];
      if (!first) return null;
      return {
        ...base,
        data: multi.data.flatMap((point, index) => {
          const own = first.values[index];
          return own === null || own === undefined
            ? []
            : [{ label: point.label, value: own }];
        }),
      };
    }
    return { ...base, data: multi.data, series: multi.series };
  }
  const data = readPoints(spec.data);
  if (!data) return null;
  return { ...base, data };
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/;
const TABLE_DELIMITER =
  /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** A table row's cells: outer pipes dropped, `\|` kept as a pipe. */
export function tableCells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\" && text[index + 1] === "|") {
      current += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const head = lines[index];
  const delimiter = lines[index + 1];
  if (head === undefined || delimiter === undefined) return false;
  if (!head.includes("|") || !delimiter.includes("|")) {
    // A one-column table still needs pipes to tell it from a heading.
    return false;
  }
  if (!TABLE_DELIMITER.test(delimiter)) return false;
  return tableCells(head).length === tableCells(delimiter).length;
}

/**
 * Splits an answer into Markdown, chart and table blocks. Code fences other
 * than ```chart stay Markdown (tables inside them are not tables). A chart
 * fence that isn't closed yet is pending, so raw JSON never flashes while
 * the answer streams.
 */
export function splitAskAnswer(text: string): AskBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: AskBlock[] = [];
  let markdown: string[] = [];
  const flush = () => {
    if (markdown.join("").trim()) {
      blocks.push({ kind: "markdown", text: markdown.join("\n") });
    }
    markdown = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const marker = fence[1] ?? "```";
      const info = (fence[2] ?? "").toLowerCase();
      const close = new RegExp(
        `^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`,
      );
      let end = index + 1;
      while (end < lines.length && !close.test(lines[end] ?? "")) end += 1;
      const closed = end < lines.length;
      // "```cha" as the last streamed line is a chart on its way.
      const isChart =
        info === "chart" ||
        (!closed &&
          index === lines.length - 1 &&
          info.length > 0 &&
          "chart".startsWith(info));
      if (isChart) {
        flush();
        const body = lines.slice(index + 1, end).join("\n");
        blocks.push({
          kind: "chart",
          chart: closed ? parseAskChart(body) : null,
          pending: !closed,
        });
      } else {
        markdown.push(...lines.slice(index, closed ? end + 1 : end));
      }
      index = closed ? end + 1 : end;
      continue;
    }
    if (isTableStart(lines, index)) {
      flush();
      const header = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length) {
        const row = lines[index] ?? "";
        if (!row.trim() || !row.includes("|")) break;
        const cells = tableCells(row);
        rows.push(header.map((_cell, column) => cells[column] ?? ""));
        index += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    markdown.push(line);
    index += 1;
  }
  flush();
  return blocks;
}
