import {
  Maximize,
  Minimize,
  MoveHorizontal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MAX_ZOOM, MIN_ZOOM, nextZoomStep } from "../components/image-view";
import {
  IconButton,
  LoadingState,
  Separator,
  TextButton,
  Toolbar,
} from "../components/ui";
import { usePreview } from "../context";
import { useFullscreen } from "../hooks";
import type { RendererProps } from "../types";

// Styles inside the shadow root. Custom properties inherit through it, so
// the surroundings follow the host theme while pages stay paper-white.
const SHADOW_CSS = `
:host { display: block; }
.docx-wrapper { background: transparent !important; padding: 24px 16px !important; display: flex; flex-flow: column; align-items: center; }
.docx-wrapper > section.docx { box-shadow: 0 1px 3px rgb(0 0 0 / 0.12), 0 0 0 1px rgb(0 0 0 / 0.04) !important; margin-bottom: 24px !important; }
a[href] { color: #0b57d0; }
`;

const SAFE_LINK = /^(https?:|mailto:)/i;

/**
 * The rendered document may only show content: anything active is removed
 * and links open outside with no opener.
 */
export function neutralizeDocument(root: ParentNode) {
  for (const element of root.querySelectorAll(
    "script, iframe, frame, object, embed, form, input, button, textarea, select, base, meta, link",
  )) {
    element.remove();
  }
  for (const element of root.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
    }
  }
  for (const link of root.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("#")) continue;
    if (SAFE_LINK.test(href)) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer nofollow");
    } else {
      link.removeAttribute("href");
    }
  }
}

/**
 * Documents (.docx), rendered into a shadow root so their
 * styles stay inside. Embedded HTML parts, fonts and comments are not
 * rendered; nothing in the document runs.
 */
export default function WordRenderer({ source, bytes }: RendererProps) {
  const { labels, rootRef } = usePreview();
  const scrollRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [zoom, setZoom] = useState<number | "width">(1);
  const [contentWidth, setContentWidth] = useState(0);
  const fullscreen = useFullscreen(rootRef);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !bytes) return;
    let cancelled = false;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const base = document.createElement("style");
    base.textContent = SHADOW_CSS;
    const styles = document.createElement("div");
    const body = document.createElement("div");
    shadow.replaceChildren(base, styles, body);
    bodyRef.current = body;
    setStatus("loading");
    import("docx-preview")
      .then(({ renderAsync }) =>
        renderAsync(bytes, body, styles, {
          className: "docx",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          // Embedded fonts would load from blob: URLs, which page policies
          // usually refuse; the document's font names still apply.
          ignoreFonts: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          // An "alt chunk" is raw HTML shown in an unsandboxed frame.
          renderAltChunks: false,
          renderComments: false,
          renderChanges: false,
          experimental: false,
          trimXmlDeclaration: true,
          useBase64URL: true,
          debug: false,
        }),
      )
      .then(() => {
        if (cancelled) return;
        neutralizeDocument(shadow);
        const wrapper = body.querySelector<HTMLElement>(".docx-wrapper");
        setContentWidth(wrapper?.scrollWidth ?? body.scrollWidth);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.warn("file preview: the document could not be rendered", error);
        setStatus("error");
      });
    return () => {
      cancelled = true;
      shadow.replaceChildren();
      bodyRef.current = null;
    };
  }, [bytes]);

  const fitWidth =
    contentWidth > 0 && scrollRef.current
      ? Math.min(
          2,
          Math.max(0.25, (scrollRef.current.clientWidth - 8) / contentWidth),
        )
      : 1;
  const scale = zoom === "width" ? fitWidth : zoom;

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.style.zoom = String(scale);
  }, [scale]);

  if (status === "error")
    throw new Error("The document could not be rendered.");

  return (
    <div className="mfp-fill">
      <Toolbar
        more={
          <>
            <IconButton
              label={labels.fitWidth}
              pressed={zoom === "width"}
              disabled={status !== "ready"}
              onClick={() => setZoom("width")}
            >
              <MoveHorizontal aria-hidden="true" />
            </IconButton>
            {fullscreen.supported ? (
              <>
                <Separator />
                <IconButton
                  label={
                    fullscreen.active
                      ? labels.exitFullScreen
                      : labels.fullScreen
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
              </>
            ) : null}
          </>
        }
      >
        <IconButton
          label={labels.zoomOut}
          disabled={status !== "ready" || scale <= MIN_ZOOM + 1e-6}
          onClick={() => setZoom(nextZoomStep(scale, -1))}
        >
          <ZoomOut aria-hidden="true" />
        </IconButton>
        <TextButton
          className="mfp-zoom-value"
          aria-label={labels.zoomReset}
          title={labels.zoomReset}
          disabled={status !== "ready"}
          onClick={() => setZoom(1)}
        >
          {`${Math.round(scale * 100)}%`}
        </TextButton>
        <IconButton
          label={labels.zoomIn}
          disabled={status !== "ready" || scale >= MAX_ZOOM - 1e-6}
          onClick={() => setZoom(nextZoomStep(scale, 1))}
        >
          <ZoomIn aria-hidden="true" />
        </IconButton>
      </Toolbar>
      {status === "loading" ? (
        <div className="mfp-overlay">
          <LoadingState />
        </div>
      ) : null}
      <section
        ref={scrollRef}
        className="mfp-scroll mfp-doc-scroll mfp-word"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the document scrolls from the keyboard
        tabIndex={0}
        aria-label={source.name}
        aria-busy={status === "loading"}
      >
        <div ref={hostRef} className="mfp-word-host" />
      </section>
    </div>
  );
}
