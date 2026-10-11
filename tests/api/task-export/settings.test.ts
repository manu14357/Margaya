import { afterEach, describe, expect, it } from "vitest";
import {
  decodeExportCursor,
  encodeExportCursor,
} from "../../../apps/api/src/task-export/controllers/list-task-exports";
import {
  entryNames,
  exportFileName,
} from "../../../apps/api/src/task-export/job";
import { isDownloadable } from "../../../apps/api/src/task-export/serialize";
import { exportRetentionDays } from "../../../apps/api/src/task-export/settings";

const original = process.env.EXPORT_RETENTION_DAYS;

afterEach(() => {
  if (original === undefined) delete process.env.EXPORT_RETENTION_DAYS;
  else process.env.EXPORT_RETENTION_DAYS = original;
});

describe("exportRetentionDays", () => {
  it("defaults to 7 and clamps to 1–30", () => {
    delete process.env.EXPORT_RETENTION_DAYS;
    expect(exportRetentionDays()).toBe(7);
    process.env.EXPORT_RETENTION_DAYS = "14";
    expect(exportRetentionDays()).toBe(14);
    process.env.EXPORT_RETENTION_DAYS = "0";
    expect(exportRetentionDays()).toBe(1);
    process.env.EXPORT_RETENTION_DAYS = "365";
    expect(exportRetentionDays()).toBe(30);
    process.env.EXPORT_RETENTION_DAYS = "soon";
    expect(exportRetentionDays()).toBe(7);
  });
});

describe("cursor", () => {
  it("round-trips and rejects malformed input", () => {
    const cursor = { createdAt: "2026-09-25T10:00:00.123456Z", id: "x1" };
    expect(decodeExportCursor(encodeExportCursor(cursor))).toEqual(cursor);
    for (const raw of [
      "not-base64-json",
      Buffer.from('["2026-09-25"]').toString("base64url"),
      Buffer.from('["nope","x"]').toString("base64url"),
      Buffer.from('["2026-09-25T10:00:00Z",""]').toString("base64url"),
    ]) {
      expect(() => decodeExportCursor(raw), raw).toThrow("Invalid cursor");
    }
  });
});

describe("file names", () => {
  it("uses the sanitized slug and the UTC date", () => {
    expect(
      exportFileName("Web App", new Date("2026-09-25T23:30:00Z"), "csv"),
    ).toBe("web-app-tasks-2026-09-25.csv");
  });

  it("keeps archive entry names unique", () => {
    const project = (slug: string) => ({
      id: slug,
      name: slug,
      slug,
      cyclesEnabled: true,
      modulesEnabled: true,
      estimatesEnabled: true,
      timeTrackingEnabled: true,
    });
    expect(
      entryNames([project("web"), project("WEB"), project("api")], "json"),
    ).toEqual(["web-tasks.json", "web-2-tasks.json", "api-tasks.json"]);
  });
});

describe("isDownloadable", () => {
  const now = new Date("2026-09-25T10:00:00Z");

  it("needs a completed export before its expiry", () => {
    const at = (ms: number) => new Date(now.getTime() + ms);
    expect(isDownloadable({ status: "completed", expiresAt: at(1) }, now)).toBe(
      true,
    );
    expect(isDownloadable({ status: "completed", expiresAt: at(0) }, now)).toBe(
      false,
    );
    expect(
      isDownloadable({ status: "expired", expiresAt: at(1000) }, now),
    ).toBe(false);
    expect(isDownloadable({ status: "completed", expiresAt: null }, now)).toBe(
      false,
    );
  });
});
