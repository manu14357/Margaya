import { describe, expect, it } from "vitest";
import {
  JiraColumns,
  parseCsvRecords,
  readJiraCsv,
} from "../../../apps/api/src/jira-import/csv";
import { readIssues } from "../../../apps/api/src/jira-import/issues";

const EXPORT = [
  "Summary,Issue key,Issue id,Labels,Labels,Labels,Comment,Comment,Sprint,Sprint,Component/s,Component/s,Watchers,Watchers,Description",
  'Login fails,WEB-1,10001,auth,,urgent,"01/Mar/24 9:05 AM;557058:ada;First line',
  'second line, with a comma","02/Mar/24 4:30 PM;557058:ben;Looks ""fixed""",Sprint 1,Sprint 2,API,Web,ada,ben,"h1. Steps',
  "",
  '* open"',
  "",
  "Plain,WEB-2,10002,,,,,,,,,,,,",
].join("\r\n");

describe("Jira CSV parsing", () => {
  it("keeps quoted newlines, commas and doubled quotes in one field", () => {
    const records = parseCsvRecords('a,"b\nc, ""d""",e\n1,2,3', ",");
    expect(records).toEqual([
      ["a", 'b\nc, "d"', "e"],
      ["1", "2", "3"],
    ]);
  });

  it("returns null for a quote that never closes", () => {
    expect(parseCsvRecords('a,"b\nc', ",")).toBeNull();
  });

  it("reads repeated columns as lists and multi-line fields", () => {
    const read = readJiraCsv(`﻿${EXPORT}`);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.table.rows).toHaveLength(2);
    // The first record spans lines 2-5; line 6 is blank.
    expect(read.table.rows.map((row) => row.line)).toEqual([2, 7]);

    const columns = new JiraColumns(read.table.headers);
    const [first] = read.table.rows;
    expect(columns.all(first?.cells ?? [], "labels")).toEqual([
      "auth",
      "urgent",
    ]);
    expect(columns.all(first?.cells ?? [], "Sprint")).toEqual([
      "Sprint 1",
      "Sprint 2",
    ]);
    expect(columns.all(first?.cells ?? [], "Component/s")).toEqual([
      "API",
      "Web",
    ]);
    expect(columns.one(first?.cells ?? [], "Description")).toBe(
      "h1. Steps\n\n* open",
    );
    expect(columns.distinct()).toContainEqual({ name: "Labels", count: 3 });
  });

  it("parses comments as date;author;body with semicolons kept in the body", () => {
    const read = readJiraCsv(EXPORT);
    if (!read.ok) throw new Error("expected a table");
    const { issues } = readIssues(read.table, "UTC");
    const [first, second] = issues;
    expect(first?.comments.map((comment) => comment.body)).toEqual([
      "First line\nsecond line, with a comma",
      'Looks "fixed"',
    ]);
    expect(first?.comments[0]?.author).toBe("557058:ada");
    expect(first?.comments[0]?.createdAt?.toISOString()).toBe(
      "2024-03-01T09:05:00.000Z",
    );
    expect(second?.labels).toEqual([]);
    expect(second?.comments).toEqual([]);
  });

  it("names comment authors from the person id columns", () => {
    const csv = [
      "Summary,Issue key,Assignee,Assignee Id,Comment",
      'A,K-1,Ada Lovelace,acc-1,"03/Mar/24 10:00 AM;acc-1;Hello; world"',
    ].join("\n");
    const read = readJiraCsv(csv);
    if (!read.ok) throw new Error("expected a table");
    const [issue] = readIssues(read.table, "UTC").issues;
    expect(issue?.comments[0]).toMatchObject({
      author: "Ada Lovelace",
      body: "Hello; world",
    });
  });

  it("reads issue link columns by type and direction", () => {
    const csv = [
      "Summary,Issue key,Outward issue link (Blocks),Inward issue link (Blocks),Outward issue link (Relates),Outward issue link (Cloners)",
      "A,K-1,K-2,K-3,K-4,K-5",
    ].join("\n");
    const read = readJiraCsv(csv);
    if (!read.ok) throw new Error("expected a table");
    const { issues, ignoredLinkTypes } = readIssues(read.table, "UTC");
    expect(issues[0]?.links).toEqual([
      { kind: "blocks", direction: "outward", key: "K-2" },
      { kind: "blocks", direction: "inward", key: "K-3" },
      { kind: "related", direction: "outward", key: "K-4" },
    ]);
    expect(ignoredLinkTypes).toEqual(["Cloners"]);
  });

  it("reads semicolon-separated files and rejects files without a Summary", () => {
    const read = readJiraCsv("Summary;Issue key\nA;K-1");
    expect(read.ok && read.table.rows[0]?.cells).toEqual(["A", "K-1"]);
    expect(readJiraCsv("Title,Key\nA,1")).toEqual({
      ok: false,
      error: "notJira",
    });
    expect(readJiraCsv("   ")).toEqual({ ok: false, error: "empty" });
    expect(readJiraCsv("Summary\n\n")).toEqual({ ok: false, error: "empty" });
    expect(readJiraCsv('Summary\n"open')).toEqual({
      ok: false,
      error: "notCsv",
    });
  });
});
