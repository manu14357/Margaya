import { describe, expect, it } from "vitest";
import {
  assertSafeEntryName,
  buildZip,
  dosDateTime,
  InvalidZipEntryName,
} from "../../../apps/api/src/task-export/encoders/zip";
import { readZip } from "./helpers/read-zip";

const when = new Date("2026-09-25T13:45:30Z");

describe("buildZip", () => {
  it("round-trips entries through the central directory with valid CRCs", () => {
    const big = Buffer.from("row,".repeat(10_000));
    const archive = buildZip(
      [
        { name: "web-tasks.csv", data: Buffer.from("a,b\r\n1,2\r\n") },
        { name: "nested/dir/big.csv", data: big },
        { name: "empty.json", data: Buffer.alloc(0) },
      ],
      when,
    );
    const entries = readZip(archive);
    expect(entries.map((entry) => entry.name)).toEqual([
      "web-tasks.csv",
      "nested/dir/big.csv",
      "empty.json",
    ]);
    expect(entries[0]?.data.toString()).toBe("a,b\r\n1,2\r\n");
    expect(entries[1]?.data.equals(big)).toBe(true);
    expect(entries[2]?.data.length).toBe(0);
    // Deflate actually compresses the repetitive entry.
    expect(archive.length).toBeLessThan(big.length / 10);
  });

  it("stores names as UTF-8 and sets the UTF-8 flag", () => {
    const name = "équipe-tâches-数据.csv";
    const [entry] = readZip(buildZip([{ name, data: Buffer.from("x") }], when));
    expect(entry?.name).toBe(name);
    expect((entry?.flags ?? 0) & 0x0800).toBe(0x0800);
  });

  it("writes an empty archive", () => {
    expect(readZip(buildZip([], when))).toEqual([]);
  });

  it("refuses names that could escape the extraction folder", () => {
    for (const name of [
      "",
      "/etc/passwd",
      "../up.csv",
      "a/../../b.csv",
      "a\\b.csv",
      "C:evil.csv",
      "a//b.csv",
    ]) {
      expect(() => assertSafeEntryName(name), name).toThrow(
        InvalidZipEntryName,
      );
    }
    expect(() =>
      buildZip([{ name: "../x", data: Buffer.from("x") }], when),
    ).toThrow(InvalidZipEntryName);
    expect(() => assertSafeEntryName("xl/worksheets/sheet1.xml")).not.toThrow();
  });
});

describe("dosDateTime", () => {
  it("packs the UTC date and time with two-second resolution", () => {
    const { date, time } = dosDateTime(when);
    expect(date >> 9).toBe(2026 - 1980);
    expect((date >> 5) & 0x0f).toBe(9);
    expect(date & 0x1f).toBe(25);
    expect(time >> 11).toBe(13);
    expect((time >> 5) & 0x3f).toBe(45);
    expect((time & 0x1f) * 2).toBe(30);
  });
});
