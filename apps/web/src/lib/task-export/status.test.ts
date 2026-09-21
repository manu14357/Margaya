import { describe, expect, it } from "vitest";
import { canDownload, displayExportStatus, isExportActive } from "./status";

const expiresAt = "2026-10-13T12:00:00.000Z";
const expiry = new Date(expiresAt);

describe("isExportActive", () => {
  it("is true while queued or processing only", () => {
    expect(isExportActive({ status: "queued" })).toBe(true);
    expect(isExportActive({ status: "processing" })).toBe(true);
    expect(isExportActive({ status: "completed" })).toBe(false);
    expect(isExportActive({ status: "failed" })).toBe(false);
    expect(isExportActive({ status: "expired" })).toBe(false);
  });
});

describe("canDownload", () => {
  it("allows a completed export before its expiry", () => {
    const before = new Date(expiry.getTime() - 1);
    expect(canDownload({ status: "completed", expiresAt }, before)).toBe(true);
  });

  it("stops at the expiry instant (exclusive), like the server", () => {
    expect(canDownload({ status: "completed", expiresAt }, expiry)).toBe(false);
    const after = new Date(expiry.getTime() + 1);
    expect(canDownload({ status: "completed", expiresAt }, after)).toBe(false);
  });

  it("never allows unfinished, failed or expired rows", () => {
    const before = new Date(expiry.getTime() - 60_000);
    for (const status of [
      "queued",
      "processing",
      "failed",
      "expired",
    ] as const) {
      expect(canDownload({ status, expiresAt }, before)).toBe(false);
    }
    expect(canDownload({ status: "completed", expiresAt: null }, before)).toBe(
      false,
    );
  });
});

describe("displayExportStatus", () => {
  it("shows a completed export past its window as expired", () => {
    expect(
      displayExportStatus({ status: "completed", expiresAt }, expiry),
    ).toBe("expired");
    const before = new Date(expiry.getTime() - 1);
    expect(
      displayExportStatus({ status: "completed", expiresAt }, before),
    ).toBe("completed");
  });

  it("passes other statuses through", () => {
    expect(
      displayExportStatus({ status: "processing", expiresAt: null }, expiry),
    ).toBe("processing");
    expect(
      displayExportStatus({ status: "failed", expiresAt: null }, expiry),
    ).toBe("failed");
  });
});
