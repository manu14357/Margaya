import { describe, expect, it } from "vitest";
import {
  buildWorkbook,
  cellSafeText,
  columnLetters,
  columnWidth,
  escapeXml,
  MAX_CELL_CHARS,
  sheetNames,
  stripIllegalXml,
  XlsxSheet,
} from "../../../apps/api/src/task-export/encoders/xlsx";
import { zipTexts } from "./helpers/read-zip";

describe("xlsx text", () => {
  it("escapes the five XML special characters", () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;",
    );
  });

  it("removes characters XML 1.0 cannot carry and keeps the rest", () => {
    const bell = String.fromCharCode(7);
    const nul = String.fromCharCode(0);
    expect(stripIllegalXml(`a${bell}b${nul}c\td\ne\rf`)).toBe("abc\td\ne\rf");
    expect(stripIllegalXml("emoji 😀 ok")).toBe("emoji 😀 ok");
    expect(stripIllegalXml(`lone ${String.fromCharCode(0xd800)}x`)).toBe(
      "lone x",
    );
    expect(stripIllegalXml(`end ${String.fromCharCode(0xdc00)}`)).toBe("end ");
    expect(stripIllegalXml(`nc${String.fromCharCode(0xfffe)}`)).toBe("nc");
  });

  it("truncates cells over the spreadsheet limit", () => {
    const long = "x".repeat(40_000);
    const safe = cellSafeText(long);
    expect(safe.length).toBeLessThanOrEqual(MAX_CELL_CHARS);
    expect(safe.endsWith("…[truncated]")).toBe(true);
    expect(safe.startsWith("x".repeat(32_750))).toBe(true);
    expect(cellSafeText("short")).toBe("short");
  });

  it("never splits a surrogate pair when truncating", () => {
    const text = `${"x".repeat(32_749)}😀${"y".repeat(100)}`;
    const safe = cellSafeText(text);
    expect(safe).toBe(`${"x".repeat(32_749)}…[truncated]`);
  });
});

describe("sheet names", () => {
  it("replaces forbidden characters, trims to 31 and deduplicates", () => {
    expect(
      sheetNames([
        "Web: [App]/v2?",
        "web: [app]/v2?",
        "",
        "   ",
        "A very long project name that goes on and on",
        "A very long project name that goes on and on",
        "'quoted'",
      ]),
    ).toEqual([
      "Web   App  v2",
      "web   app  v2 (2)",
      "Project",
      "Project (2)",
      "A very long project name that g",
      "A very long project name th (2)",
      "quoted",
    ]);
  });
});

describe("columns", () => {
  it("names columns like a spreadsheet", () => {
    expect(columnLetters(0)).toBe("A");
    expect(columnLetters(25)).toBe("Z");
    expect(columnLetters(26)).toBe("AA");
    expect(columnLetters(29)).toBe("AD");
    expect(columnLetters(701)).toBe("ZZ");
    expect(columnLetters(702)).toBe("AAA");
  });

  it("sizes columns from the header between 10 and 60", () => {
    expect(columnWidth("Key")).toBe(10);
    expect(columnWidth("Time logged (minutes)")).toBe(23);
    expect(columnWidth("x".repeat(100))).toBe(60);
  });
});

describe("workbook", () => {
  it("writes the package parts, typed cells and a frozen filtered header", () => {
    const sheet = new XlsxSheet("Tasks", ["Title", "Number", "Done", "Note"]);
    sheet.addRow(["<b>Fix & ship</b>", 12, true, null]);
    sheet.addRow(["=SUM(1)", -3.5, false, ["a", "b"]]);
    const parts = zipTexts(buildWorkbook([sheet], new Date()));

    expect([...parts.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    const xml = parts.get("xl/worksheets/sheet1.xml") ?? "";
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2"');
    expect(xml).toContain('state="frozen"');
    expect(xml).toContain('<autoFilter ref="A1:D3"/>');
    expect(xml).toContain(
      '<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Title</t></is></c>',
    );
    expect(xml).toContain(
      '<c r="A2" t="inlineStr"><is><t xml:space="preserve">&lt;b&gt;Fix &amp; ship&lt;/b&gt;</t></is></c>',
    );
    expect(xml).toContain('<c r="B2"><v>12</v></c>');
    expect(xml).toContain('<c r="C2" t="b"><v>1</v></c>');
    expect(xml).toContain('<c r="B3"><v>-3.5</v></c>');
    expect(xml).toContain('<c r="C3" t="b"><v>0</v></c>');
    // Formulas are never written: the text stays an inline string.
    expect(xml).toContain('<t xml:space="preserve">=SUM(1)</t>');
    expect(xml).not.toContain("<f>");
    expect(xml).toContain('<t xml:space="preserve">a, b</t>');
    expect(xml).not.toContain('r="D2"');

    const workbook = parts.get("xl/workbook.xml") ?? "";
    expect(workbook).toContain('<sheet name="Tasks" sheetId="1" r:id="rId1"/>');
    expect(workbook).toContain("&apos;Tasks&apos;!$A$1:$D$3");
    expect(parts.get("[Content_Types].xml")).toContain(
      'PartName="/xl/worksheets/sheet1.xml"',
    );
    expect(parts.get("xl/_rels/workbook.xml.rels")).toContain(
      'Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"',
    );
    expect(parts.get("xl/styles.xml")).toContain("<b/>");
  });

  it("writes one sheet per project", () => {
    const names = sheetNames(["Web", "Web"]);
    const sheets = names.map((name) => new XlsxSheet(name, ["Title"]));
    const parts = zipTexts(buildWorkbook(sheets, new Date()));
    const workbook = parts.get("xl/workbook.xml") ?? "";
    expect(workbook).toContain('<sheet name="Web" sheetId="1" r:id="rId1"/>');
    expect(workbook).toContain(
      '<sheet name="Web (2)" sheetId="2" r:id="rId2"/>',
    );
    expect(parts.has("xl/worksheets/sheet2.xml")).toBe(true);
  });
});
