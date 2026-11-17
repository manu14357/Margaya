import {
  Maximize,
  Minimize,
  MoveHorizontal,
  PanelLeft,
  RotateCw,
  Scan,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
  TextLayer,
} from "pdfjs-dist";
import {
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FindBar, stepIndex, useFindShortcut } from "../../components/find-bar";
import { MAX_ZOOM, MIN_ZOOM, nextZoomStep } from "../../components/image-view";
import {
  FileCard,
  IconButton,
  LoadingState,
  Separator,
  TextButton,
  Toolbar,
} from "../../components/ui";
import { usePreview } from "../../context";
import { useElementSize, useFullscreen } from "../../hooks";
import { formatLabel } from "../../labels";
import type { RendererProps } from "../../types";
import { PdfAssetFactory } from "./assets";

type PdfLib = typeof import("pdfjs-dist");

let libPromise: Promise<PdfLib> | null = null;

/** The PDF library with its worker, loaded once. */
function loadPdfjs(): Promise<PdfLib> {
  libPromise ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ])
    .then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })
    .catch((error: unknown) => {
      libPromise = null;
      throw error;
    });
  return libPromise;
}

type PageSize = { width: number; height: number; rotate: number };

type Hit = { page: number; item: number; start: number; end: number };

const GAP = 12;
// Only for an empty size list, which a loaded document never has.
const LETTER: PageSize = { width: 612, height: 792, rotate: 0 };
const PADDING = 16;
const THUMB_WIDTH = 112;
// Canvas pixels per page, kept under what browsers allocate reliably.
const MAX_CANVAS_PIXELS = 16_000_000;

type Zoom = { mode: "width" | "page" | "custom"; scale: number };

function rotatedSize(size: PageSize, rotation: number) {
  const turn = (size.rotate + rotation) % 180 !== 0;
  return turn
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

/** Restores a text-layer span after highlighting and returns its text. */
function resetDiv(div: HTMLElement, text: string) {
  if (div.dataset.mfpMarked) {
    div.textContent = text;
    delete div.dataset.mfpMarked;
  }
}

function markDiv(
  div: HTMLElement,
  text: string,
  ranges: Array<{ start: number; end: number; current: boolean }>,
): HTMLElement | null {
  div.dataset.mfpMarked = "1";
  div.textContent = "";
  let position = 0;
  let currentElement: HTMLElement | null = null;
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    if (range.start > position) {
      div.append(text.slice(position, range.start));
    }
    const mark = document.createElement("span");
    mark.className = range.current
      ? "mfp-pdf-hit mfp-pdf-hit-current"
      : "mfp-pdf-hit";
    mark.textContent = text.slice(range.start, range.end);
    div.append(mark);
    if (range.current) currentElement = mark;
    position = range.end;
  }
  if (position < text.length) div.append(text.slice(position));
  return currentElement;
}

type PageProps = {
  lib: PdfLib;
  doc: PDFDocumentProxy;
  index: number;
  size: PageSize;
  scale: number;
  rotation: number;
  root: HTMLElement | null;
  hits: Hit[];
  current: Hit | null;
  label: string;
};

/**
 * One page: a placeholder of the right size that draws its canvas and text
 * layer only while near the viewport, and drops them again when far away.
 */
const PdfPage = memo(function PdfPage({
  lib,
  doc,
  index,
  size,
  scale,
  rotation,
  root,
  hits,
  current,
  label,
}: PageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<TextLayer | null>(null);
  const [near, setNear] = useState(false);
  const [textReady, setTextReady] = useState(0);
  const { width, height } = rotatedSize(size, rotation);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setNear(Boolean(entry?.isIntersecting)),
      { root, rootMargin: "150% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textDiv = textRef.current;
    if (!near || !canvas || !textDiv) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let page: PDFPageProxy | null = null;
    (async () => {
      page = await doc.getPage(index + 1);
      if (cancelled) return;
      const viewport = page.getViewport({
        scale,
        rotation: (page.rotate + rotation) % 360,
      });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const fit = Math.sqrt(
        MAX_CANVAS_PIXELS / (viewport.width * viewport.height),
      );
      const output = Math.min(ratio, fit);
      canvas.width = Math.max(1, Math.floor(viewport.width * output));
      canvas.height = Math.max(1, Math.floor(viewport.height * output));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      renderTask = page.render({
        canvas,
        viewport,
        transform: output !== 1 ? [output, 0, 0, output, 0, 0] : undefined,
      });
      const textLayer = new lib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: textDiv,
        viewport,
      });
      textDiv.replaceChildren();
      textDiv.style.setProperty("--total-scale-factor", String(viewport.scale));
      layerRef.current = textLayer;
      await Promise.all([renderTask.promise, textLayer.render()]);
      if (!cancelled) setTextReady((value) => value + 1);
    })().catch((error: unknown) => {
      const name = (error as { name?: string } | null)?.name;
      if (!cancelled && name !== "RenderingCancelledException") {
        console.warn("file preview: a PDF page failed to draw", error);
      }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      layerRef.current?.cancel();
      layerRef.current = null;
      // Far pages give their memory back.
      canvas.width = 0;
      canvas.height = 0;
      textDiv.replaceChildren();
      page?.cleanup();
    };
  }, [near, doc, lib, index, scale, rotation]);

  // Find matches on this page, the current one scrolled into view.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !textReady) return;
    const divs = layer.textDivs;
    const strings = layer.textContentItemsStr;
    divs.forEach((div, item) => {
      resetDiv(div, strings[item] ?? "");
    });
    const byItem = new Map<
      number,
      Array<{ start: number; end: number; current: boolean }>
    >();
    for (const hit of hits) {
      const list = byItem.get(hit.item) ?? [];
      list.push({ start: hit.start, end: hit.end, current: hit === current });
      byItem.set(hit.item, list);
    }
    let currentElement: HTMLElement | null = null;
    for (const [item, ranges] of byItem) {
      const div = divs[item];
      if (!div) continue;
      const marked = markDiv(div, strings[item] ?? "", ranges);
      currentElement ??= marked;
    }
    currentElement?.scrollIntoView?.({ block: "center", inline: "nearest" });
  }, [hits, current, textReady]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled page, not a form, so no fieldset
    <div
      ref={wrapperRef}
      className="mfp-pdf-page"
      data-page={index + 1}
      role="group"
      aria-label={label}
      style={{ width: width * scale, height: height * scale }}
    >
      <canvas ref={canvasRef} className="mfp-pdf-canvas" />
      <div ref={textRef} className="mfp-pdf-text" />
    </div>
  );
});

/** A small, lazily drawn picture of a page for the sidebar. */
function Thumbnail({
  doc,
  index,
  size,
  rotation,
  root,
  active,
  label,
  onSelect,
}: {
  doc: PDFDocumentProxy;
  index: number;
  size: PageSize;
  rotation: number;
  root: HTMLElement | null;
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const { width, height } = rotatedSize(size, rotation);
  const scale = THUMB_WIDTH / width;

  useEffect(() => {
    const element = buttonRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { root, rootMargin: "100% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (active) buttonRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !canvas) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    void doc
      .getPage(index + 1)
      .then((page) => {
        if (cancelled) return;
        const viewport = page.getViewport({
          scale,
          rotation: (page.rotate + rotation) % 360,
        });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        task = page.render({ canvas, viewport });
        return task.promise;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, doc, index, scale, rotation]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className="mfp-thumb"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
    >
      <canvas
        ref={canvasRef}
        className="mfp-thumb-canvas"
        style={{ width: THUMB_WIDTH, height: height * scale }}
      />
      <span className="mfp-thumb-number" aria-hidden="true">
        {index + 1}
      </span>
    </button>
  );
}

/**
 * PDFs: continuous scroll with pages drawn as they come into
 * view, thumbnails, page jump, zoom and fit, rotation, selectable text,
 * find and full screen. PDF scripting is never enabled and nothing in the
 * document can run code.
 */
export default function PdfRenderer({ source, bytes }: RendererProps) {
  const { labels, rootRef } = usePreview();
  const [lib, setLib] = useState<PdfLib | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [problem, setProblem] = useState<"password" | "error" | null>(null);

  useEffect(() => {
    let task: PDFDocumentLoadingTask | null = null;
    let cancelled = false;
    (async () => {
      const pdfjs = await loadPdfjs();
      if (cancelled) return;
      task = pdfjs.getDocument({
        // The library moves the buffer to its worker: hand it a copy.
        data: (bytes ?? new Uint8Array()).slice(),
        BinaryDataFactory: PdfAssetFactory,
        cMapPacked: true,
        enableXfa: false,
        stopAtErrors: false,
      } as Parameters<PdfLib["getDocument"]>[0]);
      const loaded = await task.promise;
      const pageSizes = await Promise.all(
        Array.from({ length: loaded.numPages }, async (_, index) => {
          const page = await loaded.getPage(index + 1);
          const viewport = page.getViewport({ scale: 1, rotation: 0 });
          return {
            width: viewport.width,
            height: viewport.height,
            rotate: page.rotate,
          } satisfies PageSize;
        }),
      );
      if (cancelled) return;
      setLib(pdfjs);
      setDoc(loaded);
      setSizes(pageSizes);
    })().catch((error: unknown) => {
      if (cancelled) return;
      const name = (error as { name?: string } | null)?.name;
      if (name === "PasswordException") {
        setProblem("password");
      } else {
        console.warn("file preview: the PDF could not be opened", error);
        setProblem("error");
      }
    });
    return () => {
      cancelled = true;
      // Destroys the document and frees its worker.
      void task?.destroy();
    };
  }, [bytes]);

  if (problem === "password") {
    return (
      <>
        <Toolbar />
        <FileCard
          name={source.name}
          size={source.size}
          message={labels.passwordProtected}
        />
      </>
    );
  }
  if (problem === "error") throw new Error("The PDF could not be opened.");
  if (!lib || !doc || sizes.length === 0) {
    return (
      <>
        <Toolbar />
        <LoadingState />
      </>
    );
  }
  return (
    <PdfViewer
      lib={lib}
      doc={doc}
      sizes={sizes}
      name={source.name}
      rootRef={rootRef}
    />
  );
}

function PdfViewer({
  lib,
  doc,
  sizes,
  name,
  rootRef,
}: {
  lib: PdfLib;
  doc: PDFDocumentProxy;
  sizes: PageSize[];
  name: string;
  rootRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { labels } = usePreview();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [sidebarRoot, setSidebarRoot] = useState<HTMLDivElement | null>(null);
  const box = useElementSize(scrollRef);
  const fullscreen = useFullscreen(rootRef);
  const [zoom, setZoom] = useState<Zoom>({ mode: "width", scale: 1 });
  const [rotation, setRotation] = useState(0);
  const [thumbnails, setThumbnails] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageInput, setPageInput] = useState("1");

  useLayoutEffect(() => {
    setScrollRoot(scrollRef.current);
  }, []);
  useLayoutEffect(() => {
    setSidebarRoot(thumbnails ? sidebarRef.current : null);
  }, [thumbnails]);

  // Fit on the widest page and the first page's height, like a reader.
  const widest = useMemo(
    () => Math.max(...sizes.map((size) => rotatedSize(size, rotation).width)),
    [sizes, rotation],
  );
  const sizeAt = (page: number) => sizes[page] ?? sizes[0] ?? LETTER;
  const first = rotatedSize(sizeAt(0), rotation);
  const fitWidth =
    box.width > 0 ? Math.max(0.1, (box.width - PADDING * 2) / widest) : 1;
  const fitPage =
    box.height > 0
      ? Math.max(
          0.1,
          Math.min(fitWidth, (box.height - PADDING * 2) / first.height),
        )
      : fitWidth;
  const scale =
    zoom.mode === "width"
      ? Math.min(fitWidth, 4)
      : zoom.mode === "page"
        ? fitPage
        : zoom.scale;

  const offsets = useMemo(() => {
    const list: number[] = [];
    let top = PADDING;
    for (const size of sizes) {
      list.push(top);
      top += rotatedSize(size, rotation).height * scale + GAP;
    }
    return list;
  }, [sizes, rotation, scale]);

  // Keep the reader's place when the scale changes.
  const anchor = useRef({ page: 0, fraction: 0 });
  const lastScale = useRef(scale);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || lastScale.current === scale) return;
    lastScale.current = scale;
    const { page, fraction } = anchor.current;
    const height =
      rotatedSize(sizes[page] ?? sizes[0] ?? LETTER, rotation).height * scale;
    element.scrollTop = (offsets[page] ?? 0) + fraction * height;
  }, [scale, offsets, sizes, rotation]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const probe = element.scrollTop + Math.min(element.clientHeight * 0.3, 200);
    let low = 0;
    let high = offsets.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((offsets[mid] ?? 0) <= probe) low = mid;
      else high = mid - 1;
    }
    const height = rotatedSize(sizeAt(low), rotation).height * scale;
    anchor.current = {
      page: low,
      fraction: Math.min(
        1,
        Math.max(0, (element.scrollTop - (offsets[low] ?? 0)) / height),
      ),
    };
    if (low !== currentPage) {
      setCurrentPage(low);
      setPageInput(String(low + 1));
    }
  };

  const goToPage = useCallback(
    (page: number) => {
      const target = Math.min(Math.max(page, 0), sizes.length - 1);
      const element = scrollRef.current;
      if (element) element.scrollTop = (offsets[target] ?? 0) - PADDING / 2;
      setCurrentPage(target);
      setPageInput(String(target + 1));
    },
    [offsets, sizes.length],
  );

  // Find: page texts are read once, on the first search.
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [hitIndex, setHitIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const texts = useRef<string[][] | null>(null);
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const openFind = useCallback(() => setFinding(true), []);
  useFindShortcut(rootRef, openFind);

  useEffect(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!finding || !needle) {
      setHits([]);
      setHitIndex(-1);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        if (!texts.current) {
          const all: string[][] = [];
          for (let number = 1; number <= doc.numPages; number += 1) {
            const page = await doc.getPage(number);
            const content = await page.getTextContent();
            all.push(
              content.items.map((item) => ("str" in item ? item.str : "")),
            );
            if (cancelled) return;
          }
          texts.current = all;
        }
        const found: Hit[] = [];
        texts.current.forEach((items, page) => {
          items.forEach((text, item) => {
            const haystack = text.toLocaleLowerCase();
            let from = 0;
            while (found.length < 5000) {
              const at = haystack.indexOf(needle, from);
              if (at < 0) break;
              found.push({ page, item, start: at, end: at + needle.length });
              from = at + needle.length;
            }
          });
        });
        if (cancelled) return;
        setHits(found);
        // The search starts from the page in view, read once, not tracked.
        const firstAfter = found.findIndex(
          (hit) => hit.page >= currentPageRef.current,
        );
        setHitIndex(found.length ? Math.max(firstAfter, 0) : -1);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, finding, doc]);

  const currentHit = hits[hitIndex] ?? null;
  useEffect(() => {
    if (!currentHit) return;
    const element = scrollRef.current;
    if (!element) return;
    const top = offsets[currentHit.page] ?? 0;
    const height =
      rotatedSize(sizes[currentHit.page] ?? LETTER, rotation).height * scale;
    // Bring the page near; its own effect centres the match once drawn.
    if (
      top + height < element.scrollTop ||
      top > element.scrollTop + element.clientHeight
    ) {
      element.scrollTop = top - PADDING / 2;
    }
  }, [currentHit, offsets, sizes, rotation, scale]);

  const hitsByPage = useMemo(() => {
    const map = new Map<number, Hit[]>();
    for (const hit of hits) {
      const list = map.get(hit.page) ?? [];
      list.push(hit);
      map.set(hit.page, list);
    }
    return map;
  }, [hits]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoom({ mode: "custom", scale: nextZoomStep(scale, 1) });
    } else if (event.key === "-") {
      event.preventDefault();
      setZoom({ mode: "custom", scale: nextZoomStep(scale, -1) });
    }
  };

  const emptyHits: Hit[] = useMemo(() => [], []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard zoom for the focused document; the buttons offer the same
    <div className="mfp-fill" onKeyDown={onKeyDown}>
      <Toolbar
        more={
          <>
            <IconButton
              label={labels.fitWidth}
              pressed={zoom.mode === "width"}
              onClick={() => setZoom({ mode: "width", scale })}
            >
              <MoveHorizontal aria-hidden="true" />
            </IconButton>
            <IconButton
              label={labels.fitPage}
              pressed={zoom.mode === "page"}
              onClick={() => setZoom({ mode: "page", scale })}
            >
              <Scan aria-hidden="true" />
            </IconButton>
            <IconButton
              label={labels.rotate}
              onClick={() => setRotation((value) => (value + 90) % 360)}
            >
              <RotateCw aria-hidden="true" />
            </IconButton>
            <Separator />
            {fullscreen.supported ? (
              <IconButton
                label={
                  fullscreen.active ? labels.exitFullScreen : labels.fullScreen
                }
                pressed={fullscreen.active}
                onClick={fullscreen.toggle}
              >
                {fullscreen.active ? (
                  <Minimize aria-hidden="true" />
                ) : (
                  <Maximize aria-hidden="true" />
                )}
              </IconButton>
            ) : null}
          </>
        }
      >
        <IconButton
          label={labels.thumbnails}
          pressed={thumbnails}
          onClick={() => setThumbnails((value) => !value)}
        >
          <PanelLeft aria-hidden="true" />
        </IconButton>
        <span className="mfp-page-jump">
          <input
            className="mfp-page-input"
            inputMode="numeric"
            aria-label={labels.pageNumber}
            value={pageInput}
            onChange={(event) =>
              setPageInput(event.target.value.replace(/\D/g, ""))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                goToPage(Number(pageInput || 1) - 1);
              }
            }}
            onBlur={() => setPageInput(String(currentPage + 1))}
          />
          <span className="mfp-toolbar-text">
            {formatLabel(labels.pageCount, { total: sizes.length })}
          </span>
        </span>
        <Separator />
        <IconButton
          label={labels.zoomOut}
          disabled={scale <= MIN_ZOOM + 1e-6}
          onClick={() =>
            setZoom({ mode: "custom", scale: nextZoomStep(scale, -1) })
          }
        >
          <ZoomOut aria-hidden="true" />
        </IconButton>
        <TextButton
          className="mfp-zoom-value"
          aria-label={labels.zoomReset}
          title={labels.zoomReset}
          onClick={() => setZoom({ mode: "custom", scale: 1 })}
        >
          {`${Math.round(scale * 100)}%`}
        </TextButton>
        <IconButton
          label={labels.zoomIn}
          disabled={scale >= MAX_ZOOM - 1e-6}
          onClick={() =>
            setZoom({ mode: "custom", scale: nextZoomStep(scale, 1) })
          }
        >
          <ZoomIn aria-hidden="true" />
        </IconButton>
        {finding ? (
          <FindBar
            query={query}
            onQuery={setQuery}
            total={hits.length}
            current={hitIndex}
            busy={searching}
            onStep={(direction) =>
              setHitIndex((index) => stepIndex(index, hits.length, direction))
            }
            onClose={() => {
              setFinding(false);
              setQuery("");
            }}
          />
        ) : (
          <IconButton label={labels.find} onClick={openFind}>
            <Search aria-hidden="true" />
          </IconButton>
        )}
      </Toolbar>
      <div className="mfp-split">
        {thumbnails ? (
          <nav
            ref={sidebarRef}
            className="mfp-sidebar mfp-scroll"
            aria-label={labels.thumbnails}
          >
            {sizes.map((size, index) => (
              <Thumbnail
                // biome-ignore lint/suspicious/noArrayIndexKey: pages are fixed for the document
                key={index}
                doc={doc}
                index={index}
                size={size}
                rotation={rotation}
                root={sidebarRoot}
                active={index === currentPage}
                label={formatLabel(labels.pageLabel, { page: index + 1 })}
                onSelect={() => goToPage(index)}
              />
            ))}
          </nav>
        ) : null}
        <section
          ref={scrollRef}
          className="mfp-pdf-scroll mfp-scroll"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the document scrolls from the keyboard
          tabIndex={0}
          aria-label={name}
          onScroll={onScroll}
        >
          <div className="mfp-pdf-pages" style={{ padding: PADDING, gap: GAP }}>
            {scrollRoot
              ? sizes.map((size, index) => (
                  <PdfPage
                    // biome-ignore lint/suspicious/noArrayIndexKey: pages are fixed for the document
                    key={index}
                    lib={lib}
                    doc={doc}
                    index={index}
                    size={size}
                    scale={scale}
                    rotation={rotation}
                    root={scrollRoot}
                    hits={hitsByPage.get(index) ?? emptyHits}
                    current={currentHit?.page === index ? currentHit : null}
                    label={formatLabel(labels.pageLabel, { page: index + 1 })}
                  />
                ))
              : null}
          </div>
        </section>
      </div>
    </div>
  );
}
