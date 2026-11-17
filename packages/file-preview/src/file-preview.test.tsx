import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { FilePreview } from "./file-preview";
import { DEFAULT_LABELS } from "./labels";
import type { PreviewSource } from "./types";

// Heavy libraries that need a real browser (canvas, WebGL, workers) are
// replaced with small fakes; everything else runs for real.

vi.mock("./renderers/highlighter", () => ({
  highlightLines: vi.fn(async (code: string) =>
    code.split("\n").map((line) => [{ content: line, color: "#0550ae" }]),
  ),
}));

vi.mock("docx-preview", () => ({
  renderAsync: vi.fn(async (_data: unknown, body: HTMLElement) => {
    body.innerHTML = `<div class="docx-wrapper"><section class="docx">
      <h1>Quarterly report</h1>
      <table><tr><td>Revenue</td><td>42</td></tr></table>
      <a id="bad" href="javascript:alert(1)">bad</a>
      <a id="good" href="https://example.com/x">good</a>
      <img id="pic" src="data:image/png;base64,AAAA" onerror="alert(1)">
      <script>window.__pwned = true</script>
    </section></div>`;
  }),
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "/pdf.worker.js",
}));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(() => ({
    promise: Promise.reject(
      Object.assign(new Error("needs a password"), {
        name: "PasswordException",
      }),
    ),
    destroy: vi.fn(async () => {}),
  })),
}));

const pptx = vi.hoisted(() => ({ destroy: vi.fn(), disposed: vi.fn() }));
vi.mock("@aiden0z/pptx-renderer", () => {
  class PptxViewer {
    slideCount = 3;
    slideWidth = 960;
    slideHeight = 540;
    load() {}
    destroy() {
      pptx.destroy();
    }
    renderSlideToContainer(index: number, container: HTMLElement) {
      const element = document.createElement("div");
      element.textContent = `Slide body ${index + 1}`;
      container.append(element);
      return { element, ready: Promise.resolve(), dispose: pptx.disposed };
    }
    renderThumbnailToContainer(index: number, container: HTMLElement) {
      return this.renderSlideToContainer(index, container);
    }
  }
  return {
    PptxViewer,
    RECOMMENDED_ZIP_LIMITS: {},
    parseZip: vi.fn(async () => ({})),
    buildPresentation: vi.fn(() => ({})),
  };
});

// Renderer chunks load on first use; a busy machine can take a while.
configure({ asyncUtilTimeout: 15_000 });

const blobs: Blob[] = [];

beforeEach(() => {
  blobs.length = 0;
  let next = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    next += 1;
    return `blob:test/${next}`;
  });
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function bytesOf(text: string): ArrayBuffer {
  return strToU8(text).buffer as ArrayBuffer;
}

function sourceOf(name: string, data: ArrayBuffer | Uint8Array): PreviewSource {
  const buffer =
    data instanceof Uint8Array
      ? (data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer)
      : data;
  return { name, size: buffer.byteLength, load: async () => buffer.slice(0) };
}

describe("FilePreview", () => {
  it("shows text with line numbers and finds in it", async () => {
    const { container } = render(
      <FilePreview
        source={sourceOf("notes.txt", bytesOf("alpha\nbeta\nalpha beta\n"))}
      />,
    );
    await screen.findAllByText("beta", { exact: false });
    const numbers = [...container.querySelectorAll(".mfp-line-number")].map(
      (node) => node.textContent,
    );
    expect(numbers).toEqual(["1", "2", "3"]);
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.find }));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "alpha" },
    });
    await waitFor(() =>
      expect(container.querySelectorAll("mark.mfp-hit")).toHaveLength(2),
    );
    expect(screen.getByText("1 of 2")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: DEFAULT_LABELS.findNext }),
    );
    expect(screen.getByText("2 of 2")).toBeTruthy();
  });

  it("offers Download and Open for a type it can't show, with the host's toolbar", () => {
    const onDownload = vi.fn();
    const onOpenExternal = vi.fn();
    render(
      <FilePreview
        source={{ name: "firmware.bin", size: 2048, url: "https://x.test/f" }}
        onDownload={onDownload}
        onOpenExternal={onOpenExternal}
        toolbarEnd={<button type="button">host action</button>}
      />,
    );
    expect(screen.getByText(DEFAULT_LABELS.noPreview)).toBeTruthy();
    expect(screen.getByText("BIN · 2 KB")).toBeTruthy();
    expect(screen.getByText("host action")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: DEFAULT_LABELS.download }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: DEFAULT_LABELS.openExternal }),
    );
    expect(onDownload).toHaveBeenCalledOnce();
    expect(onOpenExternal).toHaveBeenCalledOnce();
  });

  it("refuses a file over its kind's limit without downloading it", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <FilePreview
        source={{
          name: "huge.docx",
          size: 900 * 1024 * 1024,
          url: "https://x.test/h",
        }}
      />,
    );
    expect(
      screen.getByText("This file is too large to preview here (limit 30 MB)."),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows an error card, still with Download, when the file can't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const onDownload = vi.fn();
    render(
      <FilePreview
        source={{
          name: "a.md",
          url: "https://x.test/a",
          credentials: "include",
        }}
        onDownload={onDownload}
      />,
    );
    await screen.findByText(DEFAULT_LABELS.errorTitle);
    expect(
      screen.getByRole("button", { name: DEFAULT_LABELS.download }),
    ).toBeTruthy();
  });

  it("uses the host's translations", () => {
    render(
      <FilePreview
        source={{ name: "x.bin", url: "https://x.test/x" }}
        labels={{ noPreview: "Keine Vorschau" }}
        onDownload={() => {}}
      />,
    );
    expect(screen.getByText("Keine Vorschau")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: DEFAULT_LABELS.download }),
    ).toBeTruthy();
  });

  it("shows a picture from its URL with zoom controls", async () => {
    const { container } = render(
      <FilePreview
        source={{ name: "photo.png", url: "https://x.test/p.png" }}
      />,
    );
    const image = await waitFor(() => {
      const element =
        container.querySelector<HTMLImageElement>("img.mfp-image");
      if (!element) throw new Error("no image yet");
      return element;
    });
    expect(image.alt).toBe("photo.png");
    expect(image.getAttribute("src")).toBe("https://x.test/p.png");
    Object.defineProperty(image, "naturalWidth", { value: 400 });
    Object.defineProperty(image, "naturalHeight", { value: 200 });
    fireEvent.load(image);
    const reset = screen.getByRole("button", {
      name: DEFAULT_LABELS.zoomReset,
    });
    expect(reset.textContent).toBe("100%");
    fireEvent.click(
      screen.getByRole("button", { name: DEFAULT_LABELS.zoomIn }),
    );
    expect(reset.textContent).toBe("150%");
    fireEvent.click(
      screen.getByRole("button", { name: DEFAULT_LABELS.rotate }),
    );
    expect(image.style.transform).toContain("rotate(90deg)");
  });

  it("moves the least used tools into a More menu when the row is narrow", async () => {
    const widths = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("mfp-toolbar-start") ? 120 : 0;
      });
    const scrolls = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("mfp-toolbar-start") ? 300 : 0;
      });
    try {
      const { container } = render(
        <FilePreview
          source={{ name: "photo.png", url: "https://x.test/p.png" }}
        />,
      );
      const more = await screen.findByRole("button", {
        name: DEFAULT_LABELS.more,
      });
      // Zoom stays in the row; rotate waits behind More.
      expect(
        screen.getByRole("button", { name: DEFAULT_LABELS.zoomIn }),
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: DEFAULT_LABELS.rotate }),
      ).toBeNull();
      expect(more.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(more);
      expect(more.getAttribute("aria-expanded")).toBe("true");
      const panel = container.querySelector(".mfp-more-panel") as HTMLElement;
      const rotate = screen.getByRole("button", {
        name: DEFAULT_LABELS.rotate,
      });
      expect(panel.contains(rotate)).toBe(true);
      // Escape closes it without reaching a dialog around the preview.
      const escapeKey = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        rotate.dispatchEvent(escapeKey);
      });
      expect(container.querySelector(".mfp-more-panel")).toBeNull();
      expect(escapeKey.defaultPrevented).toBe(true);
    } finally {
      widths.mockRestore();
      scrolls.mockRestore();
    }
  });

  it("plays video and audio in the native players", async () => {
    const { unmount } = render(
      <FilePreview source={{ name: "clip.mp4", url: "https://x.test/v" }} />,
    );
    const video = await waitFor(() => {
      const element = document.querySelector("video");
      if (!element) throw new Error("no video yet");
      return element;
    });
    expect(video.getAttribute("src")).toBe("https://x.test/v");
    expect(video.hasAttribute("controls")).toBe(true);
    unmount();
    render(
      <FilePreview source={{ name: "tone.wav", url: "https://x.test/a" }} />,
    );
    await waitFor(() =>
      expect(document.querySelector("audio")?.getAttribute("src")).toBe(
        "https://x.test/a",
      ),
    );
  });

  it("renders markdown without letting raw HTML or script links through", async () => {
    const markdown = [
      "# Release notes",
      "",
      "<script>alert(1)</script>",
      "",
      "[docs](https://example.com) and [bad](javascript:alert(1))",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");
    const { container } = render(
      <FilePreview source={sourceOf("README.md", bytesOf(markdown))} />,
    );
    await screen.findByRole("heading", { name: "Release notes" });
    const article = container.querySelector(".mfp-markdown") as HTMLElement;
    expect(article.querySelector("script")).toBeNull();
    expect(article.textContent).toContain("<script>alert(1)</script>");
    expect(article.querySelector("table")).not.toBeNull();
    const good = screen.getByRole("link", { name: "docs" });
    expect(good.getAttribute("target")).toBe("_blank");
    expect(good.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("bad").closest("a")?.hasAttribute("href")).toBe(
      false,
    );
  });

  it("shows HTML only in a fully sandboxed frame, with its source a click away", async () => {
    const html =
      '<html><head><title>T</title></head><body><h1 onclick="x()">Hi</h1><script>steal()</script><img src="https://tracker.test/p.gif"><a href="https://x.test">x</a></body></html>';
    render(<FilePreview source={sourceOf("page.html", bytesOf(html))} />);
    const frame = (await screen.findByTitle("page.html")) as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("");
    const doc = frame.getAttribute("srcdoc") ?? "";
    expect(doc).not.toContain("<script");
    expect(doc).not.toContain("onclick");
    expect(doc).not.toContain("tracker.test");
    expect(doc).not.toContain('href="https://x.test"');
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain("<h1>Hi</h1>");
    fireEvent.click(
      screen.getByRole("button", { name: DEFAULT_LABELS.viewSource }),
    );
    await screen.findByText("steal()", { exact: false });
  });

  it("sanitises an SVG and shows it as a picture from a blob", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10" fill="red"/></svg>';
    const { container } = render(
      <FilePreview source={sourceOf("logo.svg", bytesOf(svg))} />,
    );
    const image = await waitFor(() => {
      const element =
        container.querySelector<HTMLImageElement>("img.mfp-image");
      if (!element) throw new Error("no image yet");
      return element;
    });
    expect(image.getAttribute("src")).toMatch(/^blob:test\//);
    const blob = blobs.find((item) => item.type === "image/svg+xml");
    const text = await blob?.text();
    expect(text).toContain("<rect");
    expect(text).not.toContain("script");
    expect(text).not.toContain("onload");
  });

  it("pretty-prints JSON and highlights code", async () => {
    const { container } = render(
      <FilePreview
        source={sourceOf("data.json", bytesOf('{"a":1,"b":[true]}'))}
      />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll(".mfp-line").length).toBeGreaterThan(3),
    );
    const lines = [...container.querySelectorAll(".mfp-line-text")].map(
      (node) => node.textContent,
    );
    expect(lines).toContain('  "a": 1,');
    expect(
      container.querySelector('.mfp-line-text span[style*="color"]'),
    ).not.toBeNull();
  });

  it("shows CSV as a grid with column letters and row numbers", async () => {
    const { container } = render(
      <FilePreview
        source={sourceOf(
          "people.csv",
          bytesOf('name,age\n"Lee, Ann",42\nBo,7\n'),
        )}
      />,
    );
    await screen.findByText("Lee, Ann");
    const heads = [...container.querySelectorAll(".mfp-grid-colhead")].map(
      (node) => node.textContent,
    );
    expect(heads).toEqual(["A", "B"]);
    const rows = [...container.querySelectorAll(".mfp-grid-rowhead")].map(
      (node) => node.textContent,
    );
    expect(rows).toEqual(["1", "2", "3"]);
    // Numbers line up on the right.
    expect((screen.getByText("42") as HTMLElement).style.textAlign).toBe(
      "right",
    );
  });

  it("shows each sheet of a workbook on its own tab", async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["Region", "Total"],
        ["North", 1200],
      ]),
      "Summary",
    );
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([["Item"], ["Widget"]]),
      "Items",
    );
    const data = XLSX.write(book, {
      type: "array",
      bookType: "xlsx",
    }) as ArrayBuffer;
    render(<FilePreview source={sourceOf("book.xlsx", data)} />);
    await screen.findByText("North");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Summary", "Items"]);
    const items = tabs[1];
    if (!items) throw new Error("no second tab");
    fireEvent.click(items);
    await screen.findByText("Widget");
  });

  it("lists an archive and previews an entry inside it", async () => {
    const zip = zipSync({
      "readme.txt": strToU8("inside the archive"),
      "src/main.ts": strToU8("export const x = 1;"),
    });
    render(<FilePreview source={sourceOf("bundle.zip", zip)} />);
    await screen.findByText("readme.txt");
    expect(screen.getByText("src")).toBeTruthy();
    expect(screen.getByText("Items: 2")).toBeTruthy();
    fireEvent.click(screen.getByText("src"));
    await screen.findByText("main.ts");
    fireEvent.click(
      screen.getByRole("button", { name: DEFAULT_LABELS.archiveUp }),
    );
    fireEvent.click(await screen.findByText("readme.txt"));
    await screen.findByText("inside the archive");
    fireEvent.click(
      screen.getByRole("button", { name: DEFAULT_LABELS.archiveBack }),
    );
    await screen.findByText("readme.txt");
  });

  it("renders documents in a shadow root with nothing active left", async () => {
    const { container } = render(
      <FilePreview source={sourceOf("report.docx", bytesOf("PK fake"))} />,
    );
    const host = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".mfp-word-host");
      expect(element?.shadowRoot?.textContent).toContain("Quarterly report");
      return element as HTMLElement;
    });
    const shadow = host.shadowRoot as ShadowRoot;
    expect(shadow.querySelector("script")).toBeNull();
    expect(shadow.querySelector("#bad")?.hasAttribute("href")).toBe(false);
    expect(shadow.querySelector("#good")?.getAttribute("rel")).toContain(
      "noopener",
    );
    expect(shadow.querySelector("#pic")?.hasAttribute("onerror")).toBe(false);
    // The document's styles stay inside the shadow root.
    expect(document.head.querySelector("style")).toBeNull();
  });

  it("says so when a PDF needs a password", async () => {
    render(
      <FilePreview source={sourceOf("locked.pdf", bytesOf("%PDF-1.7"))} />,
    );
    // The first import of the PDF renderer resolves its asset globs.
    await screen.findByText(DEFAULT_LABELS.passwordProtected, undefined, {
      timeout: 20_000,
    });
  });

  it("steps through slides with the buttons and the arrow keys", async () => {
    const { container, unmount } = render(
      <FilePreview source={sourceOf("deck.pptx", bytesOf("PK fake"))} />,
    );
    await screen.findByText("Slide 1 of 3");
    fireEvent.click(
      screen.getByRole("button", { name: DEFAULT_LABELS.nextSlide }),
    );
    await screen.findByText("Slide 2 of 3");
    const stage = container.querySelector(".mfp-slide-stage") as HTMLElement;
    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      stage.dispatchEvent(event);
    });
    await screen.findByText("Slide 3 of 3");
    // Handled: a dialog around the preview must not also step files.
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getAllByRole("button", { name: /^Slide \d$/ }).length).toBe(
      3,
    );
    unmount();
    expect(pptx.destroy).toHaveBeenCalled();
  });
});
