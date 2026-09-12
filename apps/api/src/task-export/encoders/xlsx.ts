import { type CellValue, cellText, isNumericCell } from "./cell";
import { buildZip } from "./zip";

// A hand-written SpreadsheetML (XLSX) workbook: one sheet per project or a
// single "Tasks" sheet, inline strings, numeric and boolean cells, and a
// bold, frozen, filterable header row. Formulas are never written.

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The spreadsheet limit for one cell's text. */
export const MAX_CELL_CHARS = 32_767;
const TRUNCATED_CHARS = 32_750;
const TRUNCATION_MARK = "…[truncated]";
const MAX_SHEET_NAME = 31;
const MIN_COLUMN_WIDTH = 10;
const MAX_COLUMN_WIDTH = 60;

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Removes what XML 1.0 cannot carry: control characters other than tab, LF
 * and CR, U+FFFE and U+FFFF, and unpaired surrogates.
 */
export function stripIllegalXml(text: string): string {
  let out = "";
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (isHighSurrogate(code) && isLowSurrogate(text.charCodeAt(i + 1))) {
      i += 1;
      continue;
    }
    const illegal =
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      code === 0xfffe ||
      code === 0xffff ||
      isHighSurrogate(code) ||
      isLowSurrogate(code);
    if (illegal) {
      out += text.slice(start, i);
      start = i + 1;
    }
  }
  return start === 0 ? text : out + text.slice(start);
}

export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Text that fits one cell: legal XML, at most 32,767 characters. */
export function cellSafeText(raw: string): string {
  const text = stripIllegalXml(raw);
  if (text.length <= MAX_CELL_CHARS) return text;
  let end = TRUNCATED_CHARS;
  // Never cut a surrogate pair in half.
  if (isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
  return `${text.slice(0, end)}${TRUNCATION_MARK}`;
}

/** "A", "B", …, "Z", "AA", … for a zero-based column index. */
export function columnLetters(index: number): string {
  let letters = "";
  let n = index + 1;
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function columnWidth(header: string): number {
  return Math.min(
    MAX_COLUMN_WIDTH,
    Math.max(MIN_COLUMN_WIDTH, header.length + 2),
  );
}

/**
 * Sheet names from project names: `[ ] : * ? / \` become spaces, at most
 * 31 characters, "Project" when empty, and " (2)", " (3)"… for duplicates
 * (compared case-insensitively, as spreadsheets do).
 */
export function sheetNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const cleaned = stripIllegalXml(raw)
      .replace(/[[\]:*?/\\]/g, " ")
      .trim()
      .replace(/^'+|'+$/g, "")
      .trim();
    const base = cleaned.slice(0, MAX_SHEET_NAME).trim() || "Project";
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) {
      const suffix = ` (${n})`;
      name = `${base.slice(0, MAX_SHEET_NAME - suffix.length).trim()}${suffix}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

function stringCell(ref: string, text: string, style = ""): string {
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(cellSafeText(text))}</t></is></c>`;
}

function valueCell(ref: string, value: CellValue): string {
  if (isNumericCell(value)) return `<c r="${ref}"><v>${value}</v></c>`;
  if (typeof value === "boolean") {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const text = cellText(value);
  return text === "" ? "" : stringCell(ref, text);
}

/** Builds one worksheet row by row, so exports can count bytes as they go. */
export class XlsxSheet {
  private readonly rows: string[] = [];
  private rowCount = 1;

  constructor(
    readonly name: string,
    private readonly header: readonly string[],
  ) {
    const cells = header.map((title, index) =>
      stringCell(`${columnLetters(index)}1`, title, ' s="1"'),
    );
    this.rows.push(`<row r="1">${cells.join("")}</row>`);
  }

  /** Appends a row and returns the bytes it added. */
  addRow(values: readonly CellValue[]): number {
    this.rowCount += 1;
    const r = this.rowCount;
    const cells = values.map((value, index) =>
      valueCell(`${columnLetters(index)}${r}`, value),
    );
    const xml = `<row r="${r}">${cells.join("")}</row>`;
    this.rows.push(xml);
    return Buffer.byteLength(xml);
  }

  /** The range the header filter covers. */
  get filterRange(): string {
    const last = columnLetters(Math.max(this.header.length, 1) - 1);
    return `A1:${last}${this.rowCount}`;
  }

  toXml(): string {
    const cols = this.header
      .map(
        (title, index) =>
          `<col min="${index + 1}" max="${index + 1}" width="${columnWidth(title)}" customWidth="1"/>`,
      )
      .join("");
    return [
      XML_HEADER,
      `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">`,
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
      '<sheetFormatPr defaultRowHeight="15"/>',
      cols ? `<cols>${cols}</cols>` : "",
      `<sheetData>${this.rows.join("")}</sheetData>`,
      `<autoFilter ref="${this.filterRange}"/>`,
      "</worksheet>",
    ].join("");
  }
}

const STYLES = [
  XML_HEADER,
  `<styleSheet xmlns="${MAIN_NS}">`,
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>',
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>',
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>',
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>',
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
  "</styleSheet>",
].join("");

function quotedSheetName(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}

/** The `.xlsx` bytes of these sheets, in order. */
export function buildWorkbook(
  sheets: readonly XlsxSheet[],
  modifiedAt: Date,
): Buffer {
  const overrides = sheets
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  const contentTypes = [
    XML_HEADER,
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    overrides,
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    "</Types>",
  ].join("");
  const rootRels = `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const sheetEntries = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  const filters = sheets
    .map((sheet, index) => {
      const [from, to] = sheet.filterRange.split(":");
      const absolute = (ref = "") => ref.replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2");
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${escapeXml(quotedSheetName(sheet.name))}!${absolute(from)}:${absolute(to)}</definedName>`;
    })
    .join("");
  const workbook = `${XML_HEADER}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>${sheetEntries}</sheets><definedNames>${filters}</definedNames></workbook>`;
  const workbookRels = [
    XML_HEADER,
    `<Relationships xmlns="${PACKAGE_REL_NS}">`,
    ...sheets.map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    ),
    `<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>`,
    "</Relationships>",
  ].join("");

  const utf8 = (text: string) => Buffer.from(text, "utf8");
  return buildZip(
    [
      { name: "[Content_Types].xml", data: utf8(contentTypes) },
      { name: "_rels/.rels", data: utf8(rootRels) },
      { name: "xl/workbook.xml", data: utf8(workbook) },
      { name: "xl/_rels/workbook.xml.rels", data: utf8(workbookRels) },
      { name: "xl/styles.xml", data: utf8(STYLES) },
      ...sheets.map((sheet, index) => ({
        name: `xl/worksheets/sheet${index + 1}.xml`,
        data: utf8(sheet.toXml()),
      })),
    ],
    modifiedAt,
  );
}
