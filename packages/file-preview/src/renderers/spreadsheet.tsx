import { Search } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CellObject, WorkBook } from "xlsx";
import { FindBar, stepIndex, useFindShortcut } from "../components/find-bar";
import { IconButton, LoadingState, Notice, Toolbar } from "../components/ui";
import { usePreview } from "../context";
import { formatLabel } from "../labels";
import { formatBytes, SHEET_ROW_LIMIT } from "../limits";
import { decodeText } from "../load";
import type { RendererProps } from "../types";
import { type CellLook, readSheetLooks, type SheetLooks } from "./sheet-styles";

export type SheetModel = {
  name: string;
  rows: Array<Array<CellObject | undefined> | undefined>;
  rowCount: number;
  colCount: number;
  widths: number[];
  /** More rows existed than were parsed. */
  cut: boolean;
};

const ROW_HEIGHT = 24;
const HEADER_HEIGHT = 24;
const DEFAULT_WIDTH = 96;
const MIN_WIDTH = 40;
const MAX_WIDTH = 480;
const OVERSCAN_ROWS = 10;
const OVERSCAN_PX = 200;

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnName(index: number): string {
  let name = "";
  let value = index + 1;
  while (value > 0) {
    const rest = (value - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

export function cellText(cell: CellObject | undefined): string {
  if (!cell) return "";
  if (cell.w !== undefined) return cell.w;
  if (cell.v === undefined || cell.v === null) return "";
  return String(cell.v);
}

const NUMERIC = /^[-+]?(\d[\d,]*\.?\d*|\.\d+)([eE][-+]?\d+)?%?$/;

/** The workbook's visible sheets as plain rows of cells. */
export function sheetsOf(
  workbook: WorkBook,
  parsedRows: number,
  cutKnown: boolean,
): SheetModel[] {
  const visible = workbook.SheetNames.filter(
    (_, index) => !workbook.Workbook?.Sheets?.[index]?.Hidden,
  );
  return (visible.length ? visible : workbook.SheetNames).map((name) => {
    const sheet = workbook.Sheets[name];
    const rows = (sheet?.["!data"] ?? []) as SheetModel["rows"];
    let colCount = 0;
    let rowCount = 0;
    rows.forEach((row, index) => {
      if (!row) return;
      let last = -1;
      for (let col = row.length - 1; col >= 0; col -= 1) {
        if (cellText(row[col]) !== "") {
          last = col;
          break;
        }
      }
      if (last >= 0) {
        rowCount = index + 1;
        colCount = Math.max(colCount, last + 1);
      }
    });
    const widths = Array.from({ length: colCount }, (_, col) => {
      const info = sheet?.["!cols"]?.[col];
      const pixels = info?.wpx ?? (info?.wch ? info.wch * 7 + 10 : undefined);
      return Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, Math.round(pixels ?? DEFAULT_WIDTH)),
      );
    });
    const cut = cutKnown && rows.length >= parsedRows;
    return {
      name,
      rows,
      rowCount: cut ? Math.min(rowCount, parsedRows - 1) : rowCount,
      colCount,
      widths,
      cut,
    };
  });
}

type Hit = { row: number; col: number };

function Grid({
  sheet,
  looks,
  hits,
  current,
  label,
}: {
  sheet: SheetModel;
  looks?: Map<string, CellLook>;
  hits: Hit[];
  current: number;
  label: string;
}) {
  const scrollRef = useRef<HTMLElement>(null);
  const [view, setView] = useState({
    top: 0,
    left: 0,
    width: 800,
    height: 600,
  });
  const rowHeaderWidth = Math.max(44, String(sheet.rowCount).length * 8 + 20);

  const lefts = useMemo(() => {
    const list = [0];
    for (const width of sheet.widths)
      list.push((list[list.length - 1] ?? 0) + width);
    return list;
  }, [sheet.widths]);
  const totalWidth = lefts[lefts.length - 1] ?? 0;
  const totalHeight = sheet.rowCount * ROW_HEIGHT;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () =>
      setView({
        top: element.scrollTop,
        left: element.scrollLeft,
        width: element.clientWidth || 800,
        height: element.clientHeight || 600,
      });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const hitKeys = useMemo(
    () => new Set(hits.map((hit) => `${hit.row},${hit.col}`)),
    [hits],
  );
  const currentHit = hits[current];

  // Scroll the current match into view.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !currentHit) return;
    const top = currentHit.row * ROW_HEIGHT;
    const left = lefts[currentHit.col] ?? 0;
    const width = sheet.widths[currentHit.col] ?? DEFAULT_WIDTH;
    const viewHeight = element.clientHeight - HEADER_HEIGHT;
    const viewWidth = element.clientWidth - rowHeaderWidth;
    if (
      top < element.scrollTop ||
      top + ROW_HEIGHT > element.scrollTop + viewHeight
    ) {
      element.scrollTop = Math.max(0, top - viewHeight / 2);
    }
    if (
      left < element.scrollLeft ||
      left + width > element.scrollLeft + viewWidth
    ) {
      element.scrollLeft = Math.max(0, left - viewWidth / 3);
    }
  }, [currentHit, lefts, sheet.widths, rowHeaderWidth]);

  const firstRow = Math.max(
    0,
    Math.floor(view.top / ROW_HEIGHT) - OVERSCAN_ROWS,
  );
  const lastRow = Math.min(
    sheet.rowCount,
    Math.ceil((view.top + view.height) / ROW_HEIGHT) + OVERSCAN_ROWS,
  );
  // Columns in view, found by binary search on their left edges.
  const findCol = (x: number) => {
    let low = 0;
    let high = sheet.colCount - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((lefts[mid] ?? 0) <= x) low = mid;
      else high = mid - 1;
    }
    return Math.max(0, low);
  };
  const firstCol = sheet.colCount
    ? findCol(Math.max(0, view.left - OVERSCAN_PX))
    : 0;
  const lastCol = sheet.colCount
    ? Math.min(
        sheet.colCount,
        findCol(view.left + view.width + OVERSCAN_PX) + 1,
      )
    : 0;

  const columnHeads: ReactNode[] = [];
  for (let col = firstCol; col < lastCol; col += 1) {
    columnHeads.push(
      <div
        key={col}
        className="mfp-grid-colhead"
        style={{
          left: rowHeaderWidth + (lefts[col] ?? 0),
          width: sheet.widths[col],
        }}
      >
        {columnName(col)}
      </div>,
    );
  }
  const rowHeads: ReactNode[] = [];
  const cells: ReactNode[] = [];
  // Column lines for the columns in view; row lines are the background.
  for (let col = firstCol; col < lastCol; col += 1) {
    cells.push(
      <div
        key={`v${col}`}
        className="mfp-grid-vline"
        style={{ left: (lefts[col + 1] ?? 0) - 1, height: totalHeight }}
      />,
    );
  }
  for (let row = firstRow; row < lastRow; row += 1) {
    rowHeads.push(
      <div
        key={row}
        className="mfp-grid-rowhead"
        style={{ top: row * ROW_HEIGHT, width: rowHeaderWidth }}
      >
        {row + 1}
      </div>,
    );
    const data = sheet.rows[row];
    if (!data) continue;
    for (let col = firstCol; col < lastCol; col += 1) {
      const cell = data[col];
      const text = cellText(cell);
      const key = `${row},${col}`;
      const look = looks?.get(key);
      const fill = cell?.s as
        | { patternType?: string; fgColor?: { rgb?: string } }
        | undefined;
      const isHit = hitKeys.has(key);
      if (!text && !fill?.fgColor?.rgb && !isHit) continue;
      const numeric =
        cell?.t === "n" || (cell?.t === "s" && NUMERIC.test(text.trim()));
      const style: CSSProperties = {
        top: row * ROW_HEIGHT,
        left: lefts[col] ?? 0,
        width: sheet.widths[col],
        textAlign:
          look?.align ??
          (numeric
            ? "right"
            : cell?.t === "b" || cell?.t === "e"
              ? "center"
              : "left"),
      };
      if (look?.bold) style.fontWeight = 600;
      if (look?.italic) style.fontStyle = "italic";
      if (look?.underline) style.textDecoration = "underline";
      if (look?.color) style.color = look.color;
      if (
        fill?.patternType === "solid" &&
        fill.fgColor?.rgb &&
        /^[0-9a-f]{6,8}$/i.test(fill.fgColor.rgb)
      ) {
        // Paper colours on paper: a filled cell keeps dark text.
        style.background = `#${fill.fgColor.rgb.slice(-6)}`;
        style.color = look?.color ?? "#1c1f1d";
      }
      const isCurrent =
        currentHit !== undefined &&
        currentHit.row === row &&
        currentHit.col === col;
      cells.push(
        <div
          key={key}
          className={`mfp-grid-cell${isHit ? " mfp-grid-hit" : ""}${isCurrent ? " mfp-grid-hit-current" : ""}`}
          style={style}
          title={text.length > 24 ? text : undefined}
        >
          {text}
        </div>,
      );
    }
  }

  return (
    <section
      ref={scrollRef}
      className="mfp-grid mfp-scroll"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the sheet scrolls from the keyboard
      tabIndex={0}
      aria-label={label}
      onScroll={(event) => {
        const element = event.currentTarget;
        setView((current) => ({
          ...current,
          top: element.scrollTop,
          left: element.scrollLeft,
        }));
      }}
    >
      <div
        className="mfp-grid-inner"
        style={{
          width: rowHeaderWidth + totalWidth,
          height: HEADER_HEIGHT + totalHeight,
        }}
      >
        <div
          className="mfp-grid-head"
          style={{ height: HEADER_HEIGHT, width: rowHeaderWidth + totalWidth }}
        >
          <div
            className="mfp-grid-corner"
            style={{ width: rowHeaderWidth, height: HEADER_HEIGHT }}
          />
          {columnHeads}
        </div>
        <div
          className="mfp-grid-rows"
          style={{ width: rowHeaderWidth, height: totalHeight }}
        >
          {rowHeads}
        </div>
        <div
          className="mfp-grid-cells"
          style={{
            top: HEADER_HEIGHT,
            left: rowHeaderWidth,
            width: totalWidth,
            height: totalHeight,
          }}
        >
          {cells}
        </div>
      </div>
    </section>
  );
}

function findInSheet(sheet: SheetModel, query: string): Hit[] {
  const needle = query.toLocaleLowerCase();
  if (!needle) return [];
  const hits: Hit[] = [];
  for (let row = 0; row < sheet.rowCount; row += 1) {
    const data = sheet.rows[row];
    if (!data) continue;
    for (let col = 0; col < Math.min(data.length, sheet.colCount); col += 1) {
      if (cellText(data[col]).toLocaleLowerCase().includes(needle)) {
        hits.push({ row, col });
        if (hits.length >= 10_000) return hits;
      }
    }
  }
  return hits;
}

/**
 * Spreadsheets (XLSX, XLS, ODS) and CSV/TSV: sheet tabs, column letters
 * and row numbers, formatted values with basic cell styles, a virtualised
 * grid that only draws the cells in view, and find.
 */
export default function SpreadsheetRenderer({
  source,
  file,
  bytes,
  truncated,
}: RendererProps) {
  const { labels, rootRef } = usePreview();
  const [sheets, setSheets] = useState<SheetModel[] | null>(null);
  const [looks, setLooks] = useState<SheetLooks>(new Map());
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const data = bytes ?? new Uint8Array();
    (async () => {
      const XLSX = await import("xlsx");
      const limit = SHEET_ROW_LIMIT + 1;
      let workbook: WorkBook;
      if (file.kind === "csv") {
        let text = decodeText(data);
        // A cut file ends mid-row: drop the partial row.
        if (truncated)
          text = text.slice(0, Math.max(0, text.lastIndexOf("\n")));
        workbook = XLSX.read(text, {
          type: "string",
          raw: true,
          dense: true,
          sheetRows: limit,
          FS: file.extension === "tsv" ? "\t" : undefined,
        } as Parameters<typeof XLSX.read>[1]);
      } else {
        workbook = XLSX.read(data, {
          type: "array",
          dense: true,
          cellStyles: true,
          cellDates: false,
          sheetRows: limit,
        });
      }
      if (cancelled) return;
      setSheets(sheetsOf(workbook, limit, true));
      if (file.kind !== "csv" && /^xls[xm]$/.test(file.extension)) {
        const found = await readSheetLooks(data, limit);
        if (!cancelled) setLooks(found);
      }
    })().catch((error: unknown) => {
      if (cancelled) return;
      console.warn("file preview: the spreadsheet could not be read", error);
      setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [bytes, file.kind, file.extension, truncated]);

  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(-1);
  const deferred = useDeferredValue(query);
  const sheet = sheets?.[Math.min(active, (sheets?.length ?? 1) - 1)];
  const hits = useMemo(
    () => (finding && sheet ? findInSheet(sheet, deferred.trim()) : []),
    [finding, sheet, deferred],
  );
  const openFind = useCallback(() => setFinding(true), []);
  useFindShortcut(rootRef, openFind);

  if (failed) throw new Error("The spreadsheet could not be read.");
  if (!sheets || !sheet) {
    return (
      <>
        <Toolbar />
        <LoadingState />
      </>
    );
  }
  const shown = hits.length
    ? Math.min(Math.max(current, 0), hits.length - 1)
    : -1;

  return (
    <div className="mfp-fill">
      <Toolbar>
        {finding ? (
          <FindBar
            query={query}
            onQuery={(next) => {
              setQuery(next);
              setCurrent(0);
            }}
            total={hits.length}
            current={shown}
            busy={query !== deferred}
            onStep={(direction) =>
              setCurrent((index) => stepIndex(index, hits.length, direction))
            }
            onClose={() => {
              setFinding(false);
              setQuery("");
            }}
          />
        ) : (
          <IconButton label={labels.find} onClick={openFind}>
            <Search aria-hidden="true" />
          </IconButton>
        )}
      </Toolbar>
      {sheet.cut ? (
        <Notice>
          {formatLabel(labels.rowsTruncated, {
            rows: SHEET_ROW_LIMIT.toLocaleString(),
          })}
        </Notice>
      ) : truncated ? (
        <Notice>
          {formatLabel(labels.truncated, {
            size: formatBytes((bytes ?? new Uint8Array()).byteLength),
          })}
        </Notice>
      ) : null}
      <Grid
        key={sheet.name}
        sheet={sheet}
        looks={looks.get(sheet.name)}
        hits={hits}
        current={shown}
        label={`${source.name} · ${sheet.name}`}
      />
      {sheets.length > 1 ? (
        <div className="mfp-tabs" role="tablist" aria-label={labels.sheets}>
          {sheets.map((item, index) => (
            <button
              key={item.name}
              type="button"
              role="tab"
              aria-selected={index === active}
              tabIndex={index === active ? 0 : -1}
              className="mfp-tab"
              onClick={() => {
                setActive(index);
                setCurrent(0);
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                  return;
                event.preventDefault();
                const next =
                  (index +
                    (event.key === "ArrowRight" ? 1 : -1) +
                    sheets.length) %
                  sheets.length;
                setActive(next);
                const tabs =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    "[role=tab]",
                  );
                tabs?.[next]?.focus();
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
