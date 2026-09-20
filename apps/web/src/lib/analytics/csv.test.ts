import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";
import type { TableModel } from "./table-model";

const model: TableModel = {
  columns: [
    { id: "name", label: "Name", kind: "text" },
    { id: "value", label: 'Tasks "all"', kind: "number" },
    { id: "progress", label: "Progress", kind: "percent" },
  ],
  rows: [
    {
      id: "a",
      key: "a",
      order: 0,
      cells: { name: "Ada", value: 3, progress: 50 },
    },
    {
      id: "b",
      key: "b",
      order: 1,
      cells: { name: "Bé", value: 2.456, progress: null },
    },
  ],
  total: {
    id: "__total__",
    key: "__total__",
    order: 2,
    cells: { name: "Total", value: 4, progress: 43 },
  },
};

describe("toCsv", () => {
  it("quotes every field, doubles quotes, uses CRLF and starts with a BOM", () => {
    const text = toCsv(model);
    expect(text.startsWith("﻿")).toBe(true);
    const lines = text.slice(1).split("\r\n");
    expect(lines).toEqual([
      '"Name","Tasks ""all""","Progress"',
      '"Ada","3","50"',
      '"Bé","2.46",""',
      '"Total","4","43"',
      "",
    ]);
  });

  it("writes the rows in the order given, then the total", () => {
    const reversed = { ...model, rows: [...model.rows].reverse() };
    const lines = toCsv(reversed).slice(1).split("\r\n");
    expect(lines[1]).toContain("Bé");
    expect(lines[3]).toContain("Total");
  });
});

describe("csvCell", () => {
  it.each(["=SUM(A1)", "+1", "-2", "@cmd", "\tTab", "\rCR", "\nLF"])(
    "guards the text cell %j against formulas",
    (value) => {
      expect(csvCell(value)).toBe(`"'${value.replaceAll('"', '""')}"`);
    },
  );

  it("never prefixes numbers, even negative ones", () => {
    expect(csvCell(-3)).toBe('"-3"');
    expect(csvCell(0)).toBe('"0"');
  });

  it("writes plain numbers with a dot and no grouping", () => {
    expect(csvCell(1234567.891)).toBe('"1234567.89"');
  });

  it("leaves empty cells empty", () => {
    expect(csvCell(null)).toBe('""');
  });
});
