import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  parseRecords,
  readCsv,
} from "./csv-parse";

describe("parseRecords", () => {
  it("splits plain fields and lines", () => {
    expect(parseRecords("a,b,c\n1,2,3", ",")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("reads quoted fields with delimiters and doubled quotes", () => {
    expect(parseRecords('"a,b","say ""hi""",c', ",")).toEqual([
      ["a,b", 'say "hi"', "c"],
    ]);
  });

  it("keeps newlines inside quotes", () => {
    expect(parseRecords('title,body\n"T","line 1\r\nline 2"\n', ",")).toEqual([
      ["title", "body"],
      ["T", "line 1\r\nline 2"],
    ]);
  });

  it("accepts CRLF and LF and ignores one trailing newline", () => {
    expect(parseRecords("a,b\r\n1,2\n3,4\r\n", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("keeps empty fields and a quoted empty last field", () => {
    expect(parseRecords('a,,c\n""', ",")).toEqual([["a", "", "c"], [""]]);
  });

  it("keeps a stray quote inside an unquoted field as text", () => {
    expect(parseRecords('5" screen,x', ",")).toEqual([['5" screen', "x"]]);
  });

  it("returns null for a quote that never closes", () => {
    expect(parseRecords('a,"open\nb', ",")).toBeNull();
  });

  it("stops after the limit", () => {
    expect(parseRecords("1\n2\n3\n4", ",", 2)).toEqual([["1"], ["2"]]);
  });
});

describe("detectDelimiter", () => {
  it("detects comma, semicolon and tab", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });

  it("prefers the consistent split over a wider ragged one", () => {
    const text = "title;notes\nFix a, b and c;x\nShip;y, z, w";
    expect(detectDelimiter(text)).toBe(";");
  });

  it("ignores delimiters inside quotes", () => {
    expect(detectDelimiter('"a;b";c\n"d;e";f')).toBe(";");
    expect(detectDelimiter('"a;b;c",d\n"e;f;g",h')).toBe(",");
  });

  it("gives a tie to comma", () => {
    expect(detectDelimiter("a,b;c\n1,2;3")).toBe(",");
    expect(detectDelimiter("title\nonly")).toBe(",");
  });
});

describe("readCsv", () => {
  it("strips a UTF-8 BOM and splits the header", () => {
    const result = readCsv("﻿Title,Status\nA,Done\n");
    expect(result).toEqual({
      ok: true,
      delimiter: ",",
      table: {
        headers: ["Title", "Status"],
        rows: [["A", "Done"]],
        firstRowNumber: 2,
      },
    });
  });

  it("treats the first row as data without a header", () => {
    const result = readCsv("A,Done\nB,Todo", { hasHeader: false });
    expect(result.ok && result.table).toEqual({
      headers: ["", ""],
      rows: [
        ["A", "Done"],
        ["B", "Todo"],
      ],
      firstRowNumber: 1,
    });
  });

  it("widens the header to the widest row", () => {
    const result = readCsv("Title\nA,extra");
    expect(result.ok && result.table.headers).toEqual(["Title", ""]);
  });

  it("uses an explicit delimiter", () => {
    const result = readCsv("a,b;c\n1,2;3", { delimiter: ";" });
    expect(result.ok && result.table.headers).toEqual(["a,b", "c"]);
  });

  it("rejects an empty file or a header without rows", () => {
    expect(readCsv("")).toEqual({ ok: false, error: "empty" });
    expect(readCsv("﻿ \n\n")).toEqual({ ok: false, error: "empty" });
    expect(readCsv("Title,Status\n,\n")).toEqual({ ok: false, error: "empty" });
  });

  it("rejects binary content and unclosed quotes", () => {
    expect(readCsv("PK\u0003\u0004\u0000\u0000")).toEqual({
      ok: false,
      error: "notCsv",
    });
    expect(readCsv('Title\n"open')).toEqual({ ok: false, error: "notCsv" });
  });

  it("allows 5,000 data rows and rejects 5,001", () => {
    const rows = (count: number) =>
      `Title\n${Array.from({ length: count }, (_, i) => `T${i}`).join("\n")}`;
    expect(readCsv(rows(MAX_CSV_ROWS)).ok).toBe(true);
    expect(readCsv(rows(MAX_CSV_ROWS + 1))).toEqual({
      ok: false,
      error: "tooManyRows",
    });
  });

  it("does not count blank lines as rows", () => {
    const text = `Title\n${"A\n\n".repeat(MAX_CSV_ROWS)}`;
    expect(readCsv(text).ok).toBe(true);
  });

  it("rejects more than 5 MB", () => {
    const text = `Title\n${"x".repeat(MAX_CSV_BYTES)}`;
    expect(readCsv(text)).toEqual({ ok: false, error: "tooLarge" });
  });

  it("counts multi-byte characters as bytes", () => {
    const text = `T\n${"é".repeat(MAX_CSV_BYTES / 2 + 1)}`;
    expect(readCsv(text)).toEqual({ ok: false, error: "tooLarge" });
  });
});
