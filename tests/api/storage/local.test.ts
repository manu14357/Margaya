import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyLocalObject,
  readLocalObject,
  resolveLocalPath,
  writeLocalObject,
} from "../../../apps/api/src/storage/local";

// The built-in file store holds uploads and whole-workspace exports. On a host
// it shares with other users, only the API's own user may read them. Windows
// has no such modes, so those checks run on Linux and macOS only.
const posix = process.platform !== "win32";

const KEY = "workspace/w1/exports/e1/archive.zip";
const OTHER = "workspace/w1/exports/e2/archive.zip";

let base: string;
let root: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "margaya-local-store-"));
  root = path.join(base, "uploads");
  vi.stubEnv("MARGAYA_STORAGE_DIR", root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(base, { recursive: true, force: true });
});

const modeOf = async (file: string) => (await stat(file)).mode & 0o777;

function streamOf(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readBack(key: string) {
  const object = await readLocalObject(key);
  return new Uint8Array(
    await new Response(object.body as BodyInit).arrayBuffer(),
  );
}

describe("local file store", () => {
  it("stores, copies and reads objects into a folder it creates", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await writeLocalObject(KEY, streamOf(bytes), {
      contentType: "application/zip",
      maxBytes: 3,
      expectedSize: 3,
      overwrite: true,
    });
    await copyLocalObject(KEY, OTHER);
    expect(await readBack(KEY)).toEqual(bytes);
    expect(await readBack(OTHER)).toEqual(bytes);
  });

  it.skipIf(!posix)(
    "writes files only its own user can read, in folders only it can open",
    async () => {
      await writeLocalObject(KEY, streamOf(new Uint8Array([1, 2, 3])), {
        contentType: "application/zip",
        maxBytes: 3,
        overwrite: true,
      });
      await writeLocalObject("workspace/w1/upload.png", new Uint8Array([4]), {
        contentType: "image/png",
        maxBytes: 1,
      });
      await copyLocalObject(KEY, OTHER);

      for (const key of [KEY, OTHER, "workspace/w1/upload.png"]) {
        expect(await modeOf(resolveLocalPath(key, root)), key).toBe(0o600);
        expect(await modeOf(path.join(root, ".meta", `${key}.json`)), key).toBe(
          0o600,
        );
      }
      for (const folder of [
        "",
        ".tmp",
        ".meta",
        "workspace",
        "workspace/w1",
        "workspace/w1/exports",
        "workspace/w1/exports/e1",
        "workspace/w1/exports/e2",
        ".meta/workspace/w1/exports/e1",
      ]) {
        expect(await modeOf(path.join(root, folder)), folder).toBe(0o700);
      }
    },
  );

  it.skipIf(!posix)(
    "keeps working in a folder an earlier version made, and leaves its modes alone",
    async () => {
      // What an existing install has: folders and files with the default modes.
      const old = resolveLocalPath("workspace/w1/old.png", root);
      await mkdir(path.dirname(old), { recursive: true, mode: 0o755 });
      await chmod(root, 0o755);
      await chmod(path.join(root, "workspace"), 0o755);
      await chmod(path.dirname(old), 0o755);
      await writeFile(old, new Uint8Array([9]), { mode: 0o644 });

      await writeLocalObject(KEY, new Uint8Array([1, 2, 3]), {
        contentType: "application/zip",
        maxBytes: 3,
        overwrite: true,
      });
      await copyLocalObject("workspace/w1/old.png", "workspace/w1/copy.png");

      expect(await readBack(KEY)).toEqual(new Uint8Array([1, 2, 3]));
      expect(await readFile(old)).toEqual(Buffer.from([9]));
      expect(await modeOf(root)).toBe(0o755);
      expect(await modeOf(path.dirname(old))).toBe(0o755);
      expect(await modeOf(old)).toBe(0o644);
      expect(await modeOf(resolveLocalPath(KEY, root))).toBe(0o600);
      expect(await modeOf(path.join(root, "workspace/w1/exports"))).toBe(0o700);
      // A copy of an old file is new, so it's private like any other.
      expect(
        await modeOf(resolveLocalPath("workspace/w1/copy.png", root)),
      ).toBe(0o600);
    },
  );
});
