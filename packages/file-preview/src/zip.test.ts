import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ZIP_LIMITS } from "./limits";
import {
  extractZipEntry,
  listZip,
  type ZipEntry,
  ZipError,
  zipEntryRefusal,
} from "./zip";

function makeZip(files: Record<string, Uint8Array>) {
  const mtime = new Date(2026, 3, 5, 14, 30, 0);
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, data]) => [name, [data, { mtime }]]),
    ),
  );
}

const entry = (overrides: Partial<ZipEntry>): ZipEntry => ({
  path: "a.txt",
  name: "a.txt",
  directory: false,
  compressedSize: 10,
  size: 10,
  modified: null,
  encrypted: false,
  method: 8,
  localHeaderOffset: 0,
  ...overrides,
});

describe("listZip", () => {
  it("lists entries with sizes, dates and folders without inflating", () => {
    const zip = makeZip({
      "readme.txt": strToU8("hello"),
      "docs/guide.md": strToU8("# Guide\n".repeat(50)),
    });
    const entries = listZip(zip);
    expect(entries.map((item) => item.path)).toEqual([
      "readme.txt",
      "docs/guide.md",
    ]);
    const guide = entries[1];
    if (!guide) throw new Error("the archive lost an entry");
    expect(guide.name).toBe("guide.md");
    expect(guide.size).toBe(400);
    expect(guide.compressedSize).toBeLessThan(guide.size);
    expect(guide.modified?.getFullYear()).toBe(2026);
    expect(guide.modified?.getMonth()).toBe(3);
  });

  it("extracts one entry's bytes", async () => {
    const zip = makeZip({
      "a.txt": strToU8("first"),
      "b.txt": strToU8("second ".repeat(20)),
    });
    const [, second] = listZip(zip);
    if (!second) throw new Error("the archive lost an entry");
    const data = await extractZipEntry(zip, second);
    expect(new TextDecoder().decode(data)).toBe("second ".repeat(20));
  });

  it("refuses archives that list too many entries", () => {
    const zip = makeZip({
      "1.txt": strToU8("1"),
      "2.txt": strToU8("2"),
      "3.txt": strToU8("3"),
    });
    let error: unknown = null;
    try {
      listZip(zip, { maxEntries: 2 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ZipError);
    expect((error as ZipError).reason).toBe("too-many");
  });

  it("rejects bytes that aren't a ZIP", () => {
    expect(() =>
      listZip(strToU8("definitely not a zip file at all")),
    ).toThrowError(ZipError);
  });

  it("never inflates past the declared size of an entry that lies", async () => {
    const zip = makeZip({ "bomb.txt": new Uint8Array(100_000).fill(65) });
    const [real] = listZip(zip);
    if (!real) throw new Error("the archive lost an entry");
    const data = await extractZipEntry(zip, { ...real, size: 16 });
    expect(data.byteLength).toBe(16);
  });
});

describe("zipEntryRefusal", () => {
  it("allows ordinary entries", () => {
    expect(zipEntryRefusal(entry({}))).toBeNull();
  });

  it("refuses encrypted entries and unknown compression", () => {
    expect(zipEntryRefusal(entry({ encrypted: true }))?.reason).toBe(
      "encrypted",
    );
    expect(zipEntryRefusal(entry({ method: 14 }))?.reason).toBe("unsupported");
  });

  it("refuses entries over the per-entry limit", () => {
    const size = ZIP_LIMITS.maxEntryBytes + 1;
    expect(
      zipEntryRefusal(entry({ size, compressedSize: size - 1 }))?.reason,
    ).toBe("too-large");
  });

  it("refuses large entries with a zip-bomb expansion ratio", () => {
    const size = ZIP_LIMITS.ratioFloor + 1;
    const compressedSize = Math.floor(size / (ZIP_LIMITS.maxRatio + 1));
    expect(zipEntryRefusal(entry({ size, compressedSize }))?.reason).toBe(
      "ratio",
    );
    // Small entries may compress as well as they like.
    expect(
      zipEntryRefusal(entry({ size: 100_000, compressedSize: 10 })),
    ).toBeNull();
  });

  it("refuses once the archive's extraction budget is spent", () => {
    const size = 10 * 1024 * 1024;
    const spent = ZIP_LIMITS.maxTotalBytes - size + 1;
    expect(
      zipEntryRefusal(entry({ size, compressedSize: size }), spent)?.reason,
    ).toBe("budget");
  });
});
