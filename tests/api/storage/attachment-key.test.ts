import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertTaskImageKeyMatchesContext,
  buildObjectKeyPrefix,
  buildStorageObjectKey,
} from "../../../apps/api/src/storage/s3";
import {
  normalizeAttachmentContentType,
  sanitizeAttachmentFilename,
} from "../../../apps/api/src/task-attachment/filename";

const context = {
  workspaceId: "ws1",
  projectId: "p1",
  taskId: "t1",
  surface: "attachment" as const,
};

const STORAGE_ENV = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_KEY_PREFIX",
] as const;

describe("attachment object keys", () => {
  const saved = Object.fromEntries(
    STORAGE_ENV.map((name) => [name, process.env[name]]),
  );

  beforeEach(() => {
    process.env.S3_ENDPOINT = "https://storage.example.test";
    process.env.S3_BUCKET = "bucket";
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    delete process.env.S3_KEY_PREFIX;
  });

  afterEach(() => {
    for (const name of STORAGE_ENV) {
      const value = saved[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("puts attachments in their own folder", () => {
    expect(buildObjectKeyPrefix(context)).toBe(
      "workspace/ws1/project/p1/task/t1/attachments",
    );
    expect(buildObjectKeyPrefix({ ...context, surface: "description" })).toBe(
      "workspace/ws1/project/p1/task/t1/descriptions",
    );
    expect(buildObjectKeyPrefix({ ...context, surface: "comment" })).toBe(
      "workspace/ws1/project/p1/task/t1/comments",
    );
  });

  it("applies S3_KEY_PREFIX to new keys", () => {
    const plain = buildStorageObjectKey({
      ...context,
      filename: "Report Q3.pdf",
      contentType: "application/pdf",
    });
    expect(plain).toMatch(
      /^workspace\/ws1\/project\/p1\/task\/t1\/attachments\/report-q3-\d+-[a-z0-9]+\.pdf$/,
    );

    process.env.S3_KEY_PREFIX = "tenant-a/";
    const prefixed = buildStorageObjectKey({
      ...context,
      filename: "notes.txt",
      contentType: "text/plain",
    });
    expect(
      prefixed.startsWith(
        "tenant-a/workspace/ws1/project/p1/task/t1/attachments/",
      ),
    ).toBe(true);
    expect(assertTaskImageKeyMatchesContext(prefixed, context)).toBe(true);
  });

  it("never starts a file name with a dot, so the key check accepts it", () => {
    for (const filename of ["..notes.txt", ".env", "...pdf"]) {
      const key = buildStorageObjectKey({
        ...context,
        filename,
        contentType: "text/plain",
      });
      const name = key.split("/").at(-1) ?? "";
      expect(name.startsWith("."), key).toBe(false);
      expect(assertTaskImageKeyMatchesContext(key, context), key).toBe(true);
    }
  });

  it("accepts only this task's attachment folder with a safe suffix", () => {
    const prefix = "workspace/ws1/project/p1/task/t1/attachments/";
    expect(
      assertTaskImageKeyMatchesContext(`${prefix}file-1.pdf`, context),
    ).toBe(true);
    for (const key of [
      `${prefix}../../t2/attachments/file.pdf`,
      `${prefix}.hidden`,
      `${prefix}a/b.pdf`,
      "workspace/ws1/project/p1/task/t2/attachments/file.pdf",
      "workspace/ws1/project/p1/task/t1/descriptions/file.png",
    ]) {
      expect(assertTaskImageKeyMatchesContext(key, context), key).toBe(false);
    }
  });
});

describe("sanitizeAttachmentFilename", () => {
  it("removes control characters and path separators, then trims", () => {
    expect(sanitizeAttachmentFilename("  ../etc\\pass\u0000wd.txt ")).toBe(
      "..etcpasswd.txt",
    );
    expect(sanitizeAttachmentFilename("line\nbreak.md")).toBe("linebreak.md");
  });

  it("falls back to 'file' when nothing is left", () => {
    expect(sanitizeAttachmentFilename(" / \\ \u0007 ")).toBe("file");
  });

  it("keeps the extension when cutting to 255 characters", () => {
    const name = sanitizeAttachmentFilename(`${"a".repeat(300)}.pdf`);
    expect([...name]).toHaveLength(255);
    expect(name.endsWith(".pdf")).toBe(true);
    expect(name.startsWith("aaa")).toBe(true);
  });

  it("cuts a long name without an extension", () => {
    expect(sanitizeAttachmentFilename("b".repeat(400))).toBe("b".repeat(255));
  });

  it("counts characters, not UTF-16 units", () => {
    const name = sanitizeAttachmentFilename(`${"😀".repeat(260)}.png`);
    expect([...name]).toHaveLength(255);
    expect(name.endsWith(".png")).toBe(true);
  });
});

describe("normalizeAttachmentContentType", () => {
  it("stores an empty type as a byte stream", () => {
    expect(normalizeAttachmentContentType("")).toBe("application/octet-stream");
    expect(normalizeAttachmentContentType("  ")).toBe(
      "application/octet-stream",
    );
    expect(normalizeAttachmentContentType(" application/pdf ")).toBe(
      "application/pdf",
    );
  });
});
