import { pageSchema } from "@margaya/editor-schema";
import type { Node as PMNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import {
  hasOnlySimpleCells,
  reorderTableColumns,
  reorderTableRows,
} from "./table-tools";

const schema = pageSchema();

function cell(text: string, attrs: Record<string, unknown> = {}) {
  return schema.nodes.tableCell.create(
    attrs,
    schema.nodes.paragraph.create(null, schema.text(text)),
  );
}

function table(rows: (string | PMNode)[][]) {
  return schema.nodes.table.create(
    null,
    rows.map((row) =>
      schema.nodes.tableRow.create(
        null,
        row.map((value) => (typeof value === "string" ? cell(value) : value)),
      ),
    ),
  );
}

function texts(node: PMNode) {
  const rows: string[][] = [];
  node.forEach((row) => {
    const values: string[] = [];
    row.forEach((c) => {
      values.push(c.textContent);
    });
    rows.push(values);
  });
  return rows;
}

describe("table reordering", () => {
  const grid = table([
    ["a1", "b1", "c1"],
    ["a2", "b2", "c2"],
    ["a3", "b3", "c3"],
  ]);

  it("moves a row", () => {
    expect(texts(reorderTableRows(grid, 0, 2) as PMNode)).toEqual([
      ["a2", "b2", "c2"],
      ["a3", "b3", "c3"],
      ["a1", "b1", "c1"],
    ]);
  });

  it("moves a column in every row", () => {
    expect(texts(reorderTableColumns(grid, 2, 0) as PMNode)).toEqual([
      ["c1", "a1", "b1"],
      ["c2", "a2", "b2"],
      ["c3", "a3", "b3"],
    ]);
  });

  it("refuses moves out of range or onto itself", () => {
    expect(reorderTableRows(grid, 0, 0)).toBeNull();
    expect(reorderTableRows(grid, 2, 3)).toBeNull();
    expect(reorderTableColumns(grid, 0, -1)).toBeNull();
  });

  it("leaves tables with merged cells alone", () => {
    const merged = table([[cell("wide", { colspan: 2 })], ["a", "b"]]);
    expect(hasOnlySimpleCells(merged)).toBe(false);
    expect(reorderTableRows(merged, 0, 1)).toBeNull();
    expect(reorderTableColumns(merged, 0, 1)).toBeNull();
  });

  it("keeps the full-width flag", () => {
    const wide = schema.nodes.table.create({ fullWidth: true }, grid.content);
    expect(reorderTableRows(wide, 0, 1)?.attrs.fullWidth).toBe(true);
  });
});
