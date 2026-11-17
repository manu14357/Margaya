import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreviewFile } from "@/lib/file-preview";
import { FilePreviewDialog, useFilePreview } from "./file-preview-dialog";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast }));

// The renderers have their own tests in @margaya/file-preview; here the
// body only records what the dialog hands it.
type BodyProps = {
  source: {
    name: string;
    url?: string;
    mimeType?: string;
    credentials?: string;
  };
  labels: Record<string, string>;
  theme: string;
  onDownload?: () => void;
  onOpenExternal?: () => void;
  className?: string;
};
const body = vi.hoisted(() => ({ last: null as BodyProps | null }));
vi.mock("@margaya/file-preview", () => ({
  FilePreview: (props: BodyProps) => {
    body.last = props;
    return (
      <div data-testid="preview-body" className={props.className}>
        <div className="mfp-scroll" data-testid="preview-scroll" />
        {props.onDownload ? (
          <button type="button" onClick={props.onDownload}>
            body download
          </button>
        ) : null}
        {props.onOpenExternal ? (
          <button type="button" onClick={props.onOpenExternal}>
            body open
          </button>
        ) : null}
      </div>
    );
  },
}));

const API = "http://localhost:1337/api/asset";
const pdf: PreviewFile = {
  url: `${API}/pdf1`,
  name: "AI_Engineering_Notes.pdf",
  mimeType: "application/pdf",
  size: 12760,
};
const image: PreviewFile = {
  url: `${API}/img1`,
  name: "diagram.png",
  mimeType: "image/png",
};
const zip: PreviewFile = {
  url: `${API}/zip1`,
  name: "archive.zip",
  mimeType: "application/zip",
};
const svg: PreviewFile = {
  url: `${API}/svg1`,
  name: "drawing.svg",
  mimeType: "image/svg+xml",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  body.last = null;
  document.documentElement.classList.remove("dark");
  delete (window as { __MARGAYA_DESKTOP__?: unknown }).__MARGAYA_DESKTOP__;
  toast.success.mockReset();
  toast.error.mockReset();
});

function show(files: PreviewFile[], index = 0, onClose = vi.fn()) {
  render(<FilePreviewDialog state={{ files, index }} onClose={onClose} />);
  return onClose;
}

const dialog = () => screen.getByTestId("file-preview");
const title = () => screen.getByRole("heading").textContent;

describe("FilePreviewDialog", () => {
  it("hands a file of this server to the preview with the session", () => {
    show([pdf]);
    expect(title()).toBe("AI_Engineering_Notes.pdf");
    expect(body.last?.source).toEqual({
      name: pdf.name,
      mimeType: pdf.mimeType,
      size: pdf.size,
      url: pdf.url,
      credentials: "include",
    });
    expect(body.last?.className).toBe("margaya-file-preview");
    expect(body.last?.theme).toBe("light");
    // Translated labels, with the package's own placeholders.
    expect(body.last?.labels.download).toBe("common:filePreview.download");
    expect(body.last?.labels.pageCount).toBe(
      'common:filePreview.pageCount {"total":"{total}"}',
    );
    expect(body.last?.labels.openExternal).toBe(
      "common:filePreview.openInNewTab",
    );
  });

  it("keeps the header's links", () => {
    show([pdf]);
    const open = screen.getByRole("link", {
      name: "common:filePreview.openInNewTab",
    });
    expect(open.getAttribute("href")).toBe(pdf.url);
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toContain("noopener");
    // A plain download: same window, the server's attachment answer.
    const download = screen.getByRole("link", {
      name: "common:filePreview.download",
    });
    expect(download.getAttribute("href")).toBe(`${pdf.url}?download=1`);
    expect(download.getAttribute("download")).toBe(pdf.name);
    expect(download.hasAttribute("target")).toBe(false);
  });

  it("downloads from the preview's card the same way", () => {
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this);
    });
    show([zip]);
    fireEvent.click(screen.getByText("body download"));
    expect(clicks).toHaveLength(1);
    expect(clicks[0].getAttribute("href")).toBe(`${zip.url}?download=1`);
    expect(clicks[0].getAttribute("download")).toBe(zip.name);
    expect(clicks[0].hasAttribute("target")).toBe(false);
  });

  it("passes SVG and archives to the preview, which sanitises and unpacks them", () => {
    show([svg]);
    expect(body.last?.source.url).toBe(svg.url);
    // A tab would only download it: no new-tab link, nor a body Open.
    expect(
      screen.queryByRole("link", { name: "common:filePreview.openInNewTab" }),
    ).toBeNull();
    expect(screen.queryByText("body open")).toBeNull();
  });

  it("never fetches a non-media file from another site", () => {
    show([
      {
        url: "https://files.example.com/report.pdf",
        name: "report.pdf",
        mimeType: "application/pdf",
      },
    ]);
    expect(body.last?.source.url).toBeUndefined();
    expect(body.last?.source.credentials).toBe("omit");
    // It can still open beside the app.
    expect(screen.getByText("body open")).toBeTruthy();
  });

  it("plays pictures and media from elsewhere from their address, without the session", () => {
    show([
      {
        url: "https://cdn.example.com/a.png",
        name: "a.png",
        mimeType: "image/png",
      },
    ]);
    expect(body.last?.source.url).toBe("https://cdn.example.com/a.png");
    expect(body.last?.source.credentials).toBe("omit");
  });

  it("gives an editor image without a type an image type", () => {
    show([{ url: `${API}/img2`, name: "image", kind: "image" }]);
    expect(body.last?.source.mimeType).toBe("image/*");
  });

  it("follows the app's dark mode", async () => {
    show([image]);
    expect(body.last?.theme).toBe("light");
    document.documentElement.classList.add("dark");
    await waitFor(() => expect(body.last?.theme).toBe("dark"));
  });

  it("steps through the files with the arrows and the keyboard", () => {
    show([pdf, image, zip], 1);
    expect(title()).toBe("diagram.png");
    expect(
      screen.getByText(/common:filePreview.position/).textContent,
    ).toContain('"current":2,"total":3');
    fireEvent.click(
      screen.getByRole("button", { name: "common:filePreview.next" }),
    );
    expect(title()).toBe("archive.zip");
    expect(
      screen
        .getByRole("button", { name: "common:filePreview.next" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.keyDown(dialog(), { key: "ArrowLeft" });
    fireEvent.keyDown(dialog(), { key: "ArrowLeft" });
    expect(title()).toBe("AI_Engineering_Notes.pdf");
    expect(
      screen
        .getByRole("button", { name: "common:filePreview.previous" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("leaves the arrow keys to a focused document inside the preview", () => {
    show([pdf, image]);
    fireEvent.keyDown(screen.getByTestId("preview-scroll"), {
      key: "ArrowRight",
    });
    expect(title()).toBe("AI_Engineering_Notes.pdf");
  });

  it("copies the link", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    show([pdf]);
    fireEvent.click(
      screen.getByRole("button", { name: "common:filePreview.copyLink" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(pdf.url));
    expect(toast.success).toHaveBeenCalledWith("common:filePreview.linkCopied");
  });

  it("closes with the close button", async () => {
    const onClose = show([pdf]);
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.close" }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  describe("in the desktop app", () => {
    it("opens no window for this server's files", () => {
      (window as { __MARGAYA_DESKTOP__?: unknown }).__MARGAYA_DESKTOP__ = {
        openExternal: vi.fn(),
      };
      const open = vi.spyOn(window, "open");
      show([pdf]);
      expect(
        screen.queryByRole("link", { name: "common:filePreview.openInNewTab" }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "common:filePreview.openInBrowser",
        }),
      ).toBeNull();
      expect(screen.queryByText("body open")).toBeNull();
      expect(body.last?.labels.openExternal).toBe(
        "common:filePreview.openInBrowser",
      );
      expect(
        screen.getByRole("link", { name: "common:filePreview.download" }),
      ).toBeTruthy();
      expect(open).not.toHaveBeenCalled();
    });

    it("opens a file elsewhere in the system browser", () => {
      const openExternal = vi.fn();
      (window as { __MARGAYA_DESKTOP__?: unknown }).__MARGAYA_DESKTOP__ = {
        openExternal,
      };
      show([
        {
          url: "https://files.example.com/a.png",
          name: "a.png",
          mimeType: "image/png",
        },
      ]);
      fireEvent.click(
        screen.getByRole("button", {
          name: "common:filePreview.openInBrowser",
        }),
      );
      fireEvent.click(screen.getByText("body open"));
      expect(openExternal).toHaveBeenCalledTimes(2);
      expect(openExternal).toHaveBeenCalledWith(
        "https://files.example.com/a.png",
      );
    });
  });
});

describe("useFilePreview", () => {
  function Opener({ files }: { files: PreviewFile[] }) {
    const preview = useFilePreview();
    return (
      <>
        <button type="button" onClick={() => preview.open(files, 1)}>
          open
        </button>
        {preview.dialog}
      </>
    );
  }

  it("opens at the given file and ignores an empty list", () => {
    const { rerender } = render(<Opener files={[]} />);
    fireEvent.click(screen.getByText("open"));
    expect(screen.queryByTestId("file-preview")).toBeNull();
    rerender(<Opener files={[pdf, image]} />);
    fireEvent.click(screen.getByText("open"));
    expect(title()).toBe("diagram.png");
  });
});
