import { describe, expect, it } from "vitest";
import { cellText } from "../../../apps/api/src/task-export/encoders/cell";
import {
  CSV_BOM,
  csvField,
  csvLine,
} from "../../../apps/api/src/task-export/encoders/csv";

describe("cellText", () => {
  it("converts each kind of value", () => {
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
    expect(cellText("plain")).toBe("plain");
    expect(cellText(1234567.5)).toBe("1234567.5");
    expect(cellText(Number.NaN)).toBe("");
    expect(cellText(true)).toBe("true");
    expect(cellText(false)).toBe("false");
    expect(cellText(new Date("2026-09-25T10:00:00Z"))).toBe(
      "2026-09-25T10:00:00.000Z",
    );
    expect(cellText(["Ada", "Mia"])).toBe("Ada, Mia");
    expect(cellText([])).toBe("");
    expect(cellText([{ title: "Spec", url: "https://x.test" }])).toBe(
      '[{"title":"Spec","url":"https://x.test"}]',
    );
    expect(cellText({ a: 1 })).toBe('{"a":1}');
  });
});

describe("csv", () => {
  it("quotes every field and doubles inner quotes", () => {
    expect(csvField('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvField("")).toBe('""');
    expect(csvField(null)).toBe('""');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
  });

  it("prefixes text that a spreadsheet would read as a formula", () => {
    expect(csvField("=SUM(1)")).toBe(`"'=SUM(1)"`);
    expect(csvField("+1")).toBe(`"'+1"`);
    expect(csvField("-1")).toBe(`"'-1"`);
    expect(csvField("@cmd")).toBe(`"'@cmd"`);
    expect(csvField("\tx")).toBe(`"'\tx"`);
    expect(csvField("\rx")).toBe(`"'\rx"`);
    expect(csvField("\nx")).toBe(`"'\nx"`);
    expect(csvField("a=b")).toBe('"a=b"');
  });

  it("never prefixes numbers, even negative ones", () => {
    expect(csvField(-5)).toBe('"-5"');
    expect(csvField(0.25)).toBe('"0.25"');
  });

  it("joins string arrays and writes objects as JSON", () => {
    expect(csvField(["Ada", "Mia"])).toBe('"Ada, Mia"');
    expect(csvField([{ type: "blocks", task: "WEB-2" }])).toBe(
      '"[{""type"":""blocks"",""task"":""WEB-2""}]"',
    );
  });

  it("ends records with CRLF and has a byte-order mark constant", () => {
    expect(csvLine(["a", 1, null])).toBe('"a","1",""\r\n');
    expect(CSV_BOM).toBe("﻿");
  });
});
