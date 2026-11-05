import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  download: vi.fn(),
  getTaskExport: vi.fn(),
  saveAs: vi.fn(),
}));
vi.mock("file-saver", () => ({ saveAs: m.saveAs }));
vi.mock("i18next", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/fetchers/task-export/download-task-export", () => ({
  default: m.download,
  taskExportDownloadUrl: (id: string) =>
    `https://api.test/task-export/${id}/download`,
}));
vi.mock("@/fetchers/task-export/get-task-export", () => ({
  default: m.getTaskExport,
}));

import { saveTaskExport } from "./download";

const LARGE = 300 * 1024 * 1024;
const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

describe("saveTaskExport", () => {
  let clicked: { href: string; download: string }[];

  beforeEach(() => {
    vi.clearAllMocks();
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches a small file and saves it under its name", async () => {
    const blob = new Blob(["a,b"]);
    m.download.mockResolvedValue({ blob, fileName: "acme.csv" });

    await expect(
      saveTaskExport({ id: "exp-1", fileName: "acme.csv", sizeBytes: 2048 }),
    ).resolves.toBe("acme.csv");

    expect(m.saveAs).toHaveBeenCalledWith(blob, "acme.csv");
    expect(clicked).toEqual([]);
  });

  it("leaves a large archive to the browser, never in memory", async () => {
    m.getTaskExport.mockResolvedValue({
      status: "completed",
      expiresAt: inAWeek,
      fileName: "acme-workspace.zip",
    });

    await expect(
      saveTaskExport({ id: "exp-2", fileName: null, sizeBytes: LARGE }),
    ).resolves.toBe("acme-workspace.zip");

    expect(clicked).toEqual([
      {
        href: "https://api.test/task-export/exp-2/download",
        download: "acme-workspace.zip",
      },
    ]);
    expect(m.download).not.toHaveBeenCalled();
    expect(m.saveAs).not.toHaveBeenCalled();
    expect(document.querySelector("a")).toBeNull();
  });

  it("reports an archive that has expired instead of following the link", async () => {
    m.getTaskExport.mockResolvedValue({
      status: "expired",
      expiresAt: null,
      fileName: "acme-workspace.zip",
    });

    await expect(
      saveTaskExport({ id: "exp-3", sizeBytes: LARGE }),
    ).rejects.toThrow("settings:workspaceExports.toast.downloadError");
    expect(clicked).toEqual([]);
  });

  it("reports an archive the caller can no longer reach", async () => {
    m.getTaskExport.mockRejectedValue(new Error("Export not found"));

    await expect(
      saveTaskExport({ id: "exp-4", sizeBytes: LARGE }),
    ).rejects.toThrow("Export not found");
    expect(clicked).toEqual([]);
  });
});
