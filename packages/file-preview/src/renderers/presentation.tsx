import type { PptxViewer } from "@aiden0z/pptx-renderer";
import {
  ChevronLeft,
  ChevronRight,
  Minimize,
  Presentation,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  IconButton,
  LoadingState,
  Separator,
  TextButton,
  Toolbar,
} from "../components/ui";
import { usePreview } from "../context";
import { useElementSize, useFullscreen } from "../hooks";
import { formatLabel } from "../labels";
import type { RendererProps } from "../types";

type Deck = {
  viewer: PptxViewer;
  count: number;
  width: number;
  height: number;
};

const THUMB_WIDTH = 128;

function SlideThumb({
  deck,
  index,
  active,
  label,
  root,
  onSelect,
}: {
  deck: Deck;
  index: number;
  active: boolean;
  label: string;
  root: HTMLElement | null;
  onSelect: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = buttonRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { root, rootMargin: "0px 100%" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const slot = slotRef.current;
    if (!near || !slot) return;
    let handle: ReturnType<PptxViewer["renderThumbnailToContainer"]> = null;
    try {
      handle = deck.viewer.renderThumbnailToContainer(index, slot, {
        width: THUMB_WIDTH,
      });
    } catch (error) {
      console.warn("file preview: a slide thumbnail failed", error);
    }
    return () => {
      handle?.dispose();
      slot.replaceChildren();
    };
  }, [near, deck, index]);

  useEffect(() => {
    if (active)
      buttonRef.current?.scrollIntoView?.({
        block: "nearest",
        inline: "nearest",
      });
  }, [active]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className="mfp-slide-thumb"
      aria-label={label}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
    >
      <div
        ref={slotRef}
        className="mfp-slide-thumb-slot"
        style={{
          width: THUMB_WIDTH,
          height: (THUMB_WIDTH * deck.height) / deck.width,
        }}
        aria-hidden="true"
      />
      <span className="mfp-thumb-number" aria-hidden="true">
        {index + 1}
      </span>
    </button>
  );
}

/**
 * Slide decks (.pptx): one slide at a time fitted to the view, a thumbnail
 * strip, previous/next (arrow keys too) and a full-screen present mode.
 * Outside media links in the deck are never fetched.
 */
export default function PresentationRenderer({ source, bytes }: RendererProps) {
  const { labels } = usePreview();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const [strip, setStrip] = useState<HTMLElement | null>(null);
  const box = useElementSize(stageRef);
  const present = useFullscreen(stageRef);

  useEffect(() => {
    let cancelled = false;
    let viewer: PptxViewer | null = null;
    (async () => {
      const module = await import("@aiden0z/pptx-renderer");
      const data = (bytes ?? new Uint8Array()).slice();
      const files = await module.parseZip(
        data.buffer,
        module.RECOMMENDED_ZIP_LIMITS,
      );
      const presentation = module.buildPresentation(files);
      if (cancelled) return;
      viewer = new module.PptxViewer(document.createElement("div"), {
        externalMedia: "block",
        pdfjs: false,
        fitMode: "none",
      });
      viewer.load(presentation);
      if (viewer.slideCount === 0) throw new Error("The deck has no slides.");
      setDeck({
        viewer,
        count: viewer.slideCount,
        width: viewer.slideWidth,
        height: viewer.slideHeight,
      });
    })().catch((error: unknown) => {
      if (cancelled) return;
      console.warn("file preview: the presentation could not be read", error);
      setFailed(true);
    });
    return () => {
      cancelled = true;
      // Disposes charts and revokes the media URLs it made.
      viewer?.destroy();
    };
  }, [bytes]);

  const scale = deck
    ? Math.max(
        0.05,
        Math.min(
          (box.width - (present.active ? 0 : 32)) / deck.width,
          (box.height - (present.active ? 0 : 32)) / deck.height,
        ),
      )
    : 1;

  useEffect(() => {
    const slot = slotRef.current;
    if (!deck || !slot || box.width === 0) return;
    let handle: ReturnType<PptxViewer["renderSlideToContainer"]> = null;
    try {
      handle = deck.viewer.renderSlideToContainer(index, slot, scale);
    } catch (error) {
      console.warn("file preview: a slide failed to draw", error);
    }
    return () => {
      handle?.dispose();
      slot.replaceChildren();
    };
  }, [deck, index, scale, box.width]);

  if (failed) throw new Error("The presentation could not be read.");
  if (!deck) {
    return (
      <>
        <Toolbar />
        <LoadingState />
      </>
    );
  }

  const go = (next: number) =>
    setIndex(Math.min(Math.max(next, 0), deck.count - 1));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLInputElement) return;
    const forward = ["ArrowRight", "ArrowDown", "PageDown", " "];
    const back = ["ArrowLeft", "ArrowUp", "PageUp"];
    // Right-to-left pages read the horizontal arrows the other way round.
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    let key = event.key;
    if (rtl && key === "ArrowLeft") key = "ArrowRight";
    else if (rtl && key === "ArrowRight") key = "ArrowLeft";
    if (forward.includes(key)) go(index + 1);
    else if (back.includes(key)) go(index - 1);
    else if (key === "Home") go(0);
    else if (key === "End") go(deck.count - 1);
    else return;
    // Handled here: the dialog around the preview must not also step files.
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys step slides; the buttons offer the same
    <div className="mfp-fill" onKeyDown={onKeyDown}>
      <Toolbar
        more={
          present.supported ? (
            <>
              <Separator />
              <TextButton
                onClick={() => {
                  present.toggle();
                  stageRef.current?.focus({ preventScroll: true });
                }}
              >
                <Presentation aria-hidden="true" />
                {labels.present}
              </TextButton>
            </>
          ) : null
        }
      >
        <IconButton
          label={labels.previousSlide}
          disabled={index === 0}
          onClick={() => go(index - 1)}
        >
          <ChevronLeft className="mfp-flip-rtl" aria-hidden="true" />
        </IconButton>
        <span className="mfp-toolbar-text" aria-live="polite">
          {formatLabel(labels.slideCount, {
            current: index + 1,
            total: deck.count,
          })}
        </span>
        <IconButton
          label={labels.nextSlide}
          disabled={index === deck.count - 1}
          onClick={() => go(index + 1)}
        >
          <ChevronRight className="mfp-flip-rtl" aria-hidden="true" />
        </IconButton>
      </Toolbar>
      {/* biome-ignore lint/a11y/useSemanticElements: a labelled slide, not a form, so no fieldset */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: in present mode a click steps on, as the arrow keys above do */}
      <div
        ref={stageRef}
        className={`mfp-slide-stage mfp-scroll${present.active ? " mfp-presenting" : ""}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys step slides when the stage has focus
        tabIndex={0}
        role="group"
        aria-roledescription="slide"
        aria-label={`${source.name} Â· ${formatLabel(labels.slideLabel, { number: index + 1 })}`}
        onClick={(event) => {
          if (present.active && !(event.target as HTMLElement).closest("a"))
            go(index + 1);
        }}
      >
        <div
          ref={slotRef}
          className="mfp-slide"
          style={{ width: deck.width * scale, height: deck.height * scale }}
        />
        {present.active ? (
          <div className="mfp-present-bar">
            <IconButton
              label={labels.previousSlide}
              disabled={index === 0}
              onClick={(event) => {
                event.stopPropagation();
                go(index - 1);
              }}
            >
              <ChevronLeft className="mfp-flip-rtl" aria-hidden="true" />
            </IconButton>
            <span className="mfp-toolbar-text">{`${index + 1} / ${deck.count}`}</span>
            <IconButton
              label={labels.nextSlide}
              disabled={index === deck.count - 1}
              onClick={(event) => {
                event.stopPropagation();
                go(index + 1);
              }}
            >
              <ChevronRight className="mfp-flip-rtl" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={labels.exitPresent}
              onClick={(event) => {
                event.stopPropagation();
                present.toggle();
              }}
            >
              <Minimize aria-hidden="true" />
            </IconButton>
          </div>
        ) : null}
      </div>
      <nav
        ref={setStrip}
        className="mfp-slide-strip mfp-scroll"
        aria-label={labels.thumbnails}
      >
        {Array.from({ length: deck.count }, (_, slide) => (
          <SlideThumb
            // biome-ignore lint/suspicious/noArrayIndexKey: slides are fixed for the deck
            key={slide}
            deck={deck}
            index={slide}
            active={slide === index}
            label={formatLabel(labels.slideLabel, { number: slide + 1 })}
            root={strip}
            onSelect={() => go(slide)}
          />
        ))}
      </nav>
    </div>
  );
}
