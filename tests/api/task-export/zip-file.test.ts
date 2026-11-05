import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ZipFileWriter,
  ZipLimitError,
} from "../../../apps/api/src/task-export/encoders/zip-file";
import { readZip } from "./helpers/read-zip";

const when = new Date("2026-11-06T10:00:00Z");
let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "margaya-zip-file-"));
  file = path.join(dir, "out.zip");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function* chunks(...parts: (string | Uint8Array)[]) {
  yield* parts;
}

describe("ZipFileWriter", () => {
  it("writes compressed and stored entries a reader can verify", async () => {
    const big = "row,".repeat(50_000);
    const binary = Buffer.from([0, 1, 2, 3, 250, 251, 252, 253]);
    const writer = await ZipFileWriter.create(file, when);

    await writer.add("data/big.json", chunks(big.slice(0, 7), big.slice(7)), {
      compress: true,
    });
    await writer.add("files/a/photo.bin", chunks(binary), { compress: false });
    await writer.add("empty.json", [], { compress: true });
    const size = await writer.finish();

    const archive = await readFile(file);
    expect(archive.length).toBe(size);
    const entries = readZip(archive);
    expect(entries.map((entry) => entry.name)).toEqual([
      "data/big.json",
      "files/a/photo.bin",
      "empty.json",
    ]);
    expect(entries[0]?.data.toString()).toBe(big);
    expect(entries[1]?.data.equals(binary)).toBe(true);
    expect(entries[2]?.data.length).toBe(0);
    // Deflate actually ran for documents, and files were stored as they are.
    expect(archive.length).toBeLessThan(big.length / 2);
    expect(archive.readUInt16LE(8)).toBe(8);
  });

  // POSIX modes don't exist on Windows, where the temp folder is per-user.
  it.skipIf(process.platform === "win32")(
    "creates the archive readable by its owner only",
    async () => {
      const writer = await ZipFileWriter.create(file, when);
      await writer.add("first.txt", ["first"], { compress: false });
      await writer.finish();
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    },
  );

  it("refuses a path that already exists, so nobody can plant the file", async () => {
    await writeFile(file, "planted by someone else");
    await expect(ZipFileWriter.create(file, when)).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect((await readFile(file)).toString()).toBe("planted by someone else");
  });

  it("stays valid without an entry whose source failed", async () => {
    const writer = await ZipFileWriter.create(file, when);
    await writer.add("first.txt", ["first"], { compress: false });
    async function* failing() {
      yield "partial bytes that must not survive";
      throw new Error("storage went away");
    }
    await expect(
      writer.add("broken.txt", failing(), { compress: false }),
    ).rejects.toThrow("storage went away");
    await writer.add("last.txt", ["last"], { compress: true });
    await writer.finish();

    const entries = readZip(await readFile(file));
    expect(entries.map((entry) => entry.name)).toEqual([
      "first.txt",
      "last.txt",
    ]);
    expect(entries[1]?.data.toString()).toBe("last");
  });

  it("drops bytes a failed last entry wrote past the end", async () => {
    const writer = await ZipFileWriter.create(file, when);
    await writer.add("kept.txt", ["kept"], { compress: false });
    async function* failing() {
      yield "x".repeat(100_000);
      throw new Error("gone");
    }
    await expect(
      writer.add("broken.txt", failing(), { compress: false }),
    ).rejects.toThrow("gone");
    const size = await writer.finish();

    expect((await readFile(file)).length).toBe(size);
    expect(size).toBeLessThan(1_000);
  });

  it("refuses to grow past its byte limit", async () => {
    const writer = await ZipFileWriter.create(file, when, 1_000);
    await expect(
      writer.add("big.bin", ["x".repeat(5_000)], { compress: false }),
    ).rejects.toBeInstanceOf(ZipLimitError);
    await writer.abort();
  });

  it("refuses entry names that could leave the extraction folder", async () => {
    const writer = await ZipFileWriter.create(file, when);
    await expect(
      writer.add("files/../../evil", ["x"], { compress: false }),
    ).rejects.toThrow("Invalid entry name");
    await writer.abort();
  });

  it("honours an abort signal", async () => {
    const writer = await ZipFileWriter.create(file, when);
    const controller = new AbortController();
    async function* slow() {
      yield "start";
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 20));
      yield "end";
    }
    await expect(
      writer.add("slow.bin", slow(), {
        compress: false,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    await writer.abort();
  });
});
