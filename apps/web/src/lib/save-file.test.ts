import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ saveAs: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs: m.saveAs }));

import { saveFile } from "./save-file";

describe("saveFile", () => {
  const createObjectURL = vi.fn(() => "blob:https://app.test/1");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(window.URL, { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__MARGAYA_DESKTOP__");
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("uses file-saver in a browser", () => {
    const blob = new Blob(["x"], { type: "image/png" });
    saveFile(blob, "Sprint plan.png");
    expect(m.saveAs).toHaveBeenCalledWith(blob, "Sprint plan.png");
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("clicks a named download link in the desktop app", () => {
    Object.defineProperty(window, "__MARGAYA_DESKTOP__", {
      configurable: true,
      value: { version: "1.0.0" },
    });
    const clicked: { href: string; download: string }[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({ href: this.href, download: this.download });
      });
    const blob = new Blob(["x"], { type: "image/png" });

    saveFile(blob, "Sprint plan.png");

    expect(m.saveAs).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([
      { href: "blob:https://app.test/1", download: "Sprint plan.png" },
    ]);
    // The link is gone; the blob stays readable until the download started.
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:https://app.test/1");
    click.mockRestore();
  });
});
