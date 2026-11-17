import {
  Maximize,
  Minimize,
  RotateCw,
  Scan,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { usePreview } from "../context";
import { useElementSize, useFullscreen } from "../hooks";
import {
  ErrorState,
  IconButton,
  LoadingState,
  Separator,
  TextButton,
  Toolbar,
} from "./ui";

export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export function nextZoomStep(current: number, direction: 1 | -1): number {
  if (direction > 0) {
    return ZOOM_STEPS.find((step) => step > current + 1e-6) ?? current;
  }
  return (
    [...ZOOM_STEPS].reverse().find((step) => step < current - 1e-6) ?? current
  );
}

/** Scale that shows the whole (rotated) image, never above 100%. */
export function fitScale(
  natural: { width: number; height: number },
  box: { width: number; height: number },
  rotation: number,
): number {
  const sideways = rotation % 180 !== 0;
  const width = sideways ? natural.height : natural.width;
  const height = sideways ? natural.width : natural.height;
  if (!width || !height || !box.width || !box.height) return 1;
  return Math.min(box.width / width, box.height / height, 1);
}

/**
 * A picture with zoom (buttons, +/-/0, Ctrl+wheel), fit, rotation, drag
 * to pan and full screen.
 */
export function ImageView({ src, name }: { src: string; name: string }) {
  const { labels, rootRef } = usePreview();
  const scrollRef = useRef<HTMLDivElement>(null);
  const box = useElementSize(scrollRef);
  const [natural, setNatural] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [rotation, setRotation] = useState(0);
  const fullscreen = useFullscreen(rootRef);

  const fit = natural ? fitScale(natural, box, rotation) : 1;
  const scale = zoom === "fit" ? fit : zoom;
  const sideways = rotation % 180 !== 0;
  const width = natural ? natural.width * scale : 0;
  const height = natural ? natural.height * scale : 0;
  const stageWidth = sideways ? height : width;
  const stageHeight = sideways ? width : height;
  const pannable = stageWidth > box.width + 1 || stageHeight > box.height + 1;

  // Zooming keeps the point at the centre of the view where it was.
  const previousScale = useRef(scale);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const before = previousScale.current;
    previousScale.current = scale;
    if (!element || before === scale || !before) return;
    const ratio = scale / before;
    const centerX = element.scrollLeft + element.clientWidth / 2;
    const centerY = element.scrollTop + element.clientHeight / 2;
    element.scrollLeft = centerX * ratio - element.clientWidth / 2;
    element.scrollTop = centerY * ratio - element.clientHeight / 2;
  }, [scale]);

  const zoomBy = (direction: 1 | -1) =>
    setZoom(() => nextZoomStep(scale, direction));

  // Ctrl/Cmd + wheel zooms; it needs a non-passive listener to stop the
  // page zooming instead.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(nextZoomStep(scaleRef.current, event.deltaY < 0 ? 1 : -1));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!pannable || event.button !== 0) return;
    const element = scrollRef.current;
    if (!element) return;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: element.scrollLeft,
      top: element.scrollTop,
    };
    element.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    const element = scrollRef.current;
    if (!start || !element) return;
    element.scrollLeft = start.left - (event.clientX - start.x);
    element.scrollTop = start.top - (event.clientY - start.y);
  };
  const endDrag = () => {
    drag.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(1);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomBy(-1);
    } else if (event.key === "0") {
      event.preventDefault();
      setZoom("fit");
    }
  };

  if (failed) return <ErrorState name={name} />;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard zoom for the focused picture; the buttons offer the same
    <div className="mfp-fill" onKeyDown={onKeyDown}>
      <Toolbar
        more={
          <>
            <IconButton
              label={labels.fitPage}
              pressed={zoom === "fit"}
              disabled={!natural}
              onClick={() => setZoom("fit")}
            >
              <Scan aria-hidden="true" />
            </IconButton>
            <Separator />
            <IconButton
              label={labels.rotate}
              disabled={!natural}
              onClick={() => setRotation((value) => (value + 90) % 360)}
            >
              <RotateCw aria-hidden="true" />
            </IconButton>
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
          label={labels.zoomOut}
          disabled={!natural || scale <= MIN_ZOOM + 1e-6}
          onClick={() => zoomBy(-1)}
        >
          <ZoomOut aria-hidden="true" />
        </IconButton>
        <TextButton
          className="mfp-zoom-value"
          aria-label={labels.zoomReset}
          title={labels.zoomReset}
          disabled={!natural}
          onClick={() => setZoom("fit")}
        >
          {`${Math.round(scale * 100)}%`}
        </TextButton>
        <IconButton
          label={labels.zoomIn}
          disabled={!natural || scale >= MAX_ZOOM - 1e-6}
          onClick={() => zoomBy(1)}
        >
          <ZoomIn aria-hidden="true" />
        </IconButton>
      </Toolbar>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag to pan; the scrollbars and the keyboard scroll the same area */}
      <div
        ref={scrollRef}
        className={`mfp-image-scroll mfp-scroll${pannable ? " mfp-pannable" : ""}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the picture scrolls and zooms from the keyboard
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() =>
          setZoom(zoom === "fit" && fit < 1 ? 1 : zoom === "fit" ? 2 : "fit")
        }
      >
        {!natural ? (
          <div className="mfp-overlay">
            <LoadingState />
          </div>
        ) : null}
        <div
          className="mfp-image-canvas"
          style={{
            width: Math.max(stageWidth, box.width),
            height: Math.max(stageHeight, box.height),
          }}
        >
          <div
            className="mfp-image-stage"
            style={{ width: stageWidth, height: stageHeight }}
          >
            <img
              src={src}
              alt={name}
              draggable={false}
              className="mfp-image"
              style={{
                width: width || undefined,
                height: height || undefined,
                transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                visibility: natural ? "visible" : "hidden",
              }}
              onLoad={(event) => {
                const image = event.currentTarget;
                setNatural({
                  width: image.naturalWidth || 300,
                  height: image.naturalHeight || 150,
                });
              }}
              onError={() => setFailed(true)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
