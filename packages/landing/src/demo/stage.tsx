"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useLandingCopy } from "../copy";
import { cn } from "../lib/cn";
import { CollaboratorCursor, DemoCursor } from "./cursor";
import { useInView, useReducedMotion, useTabVisible, useWidth } from "./hooks";
import { KeyHint } from "./key-hint";
import { type CursorFrame, type DemoHost, runScript } from "./runner";
import { finalStateOf } from "./steps";
import { createTimeline, type Timeline } from "./timeline";
import type {
  CursorId,
  CursorKind,
  DemoScene,
  Point,
  StageSize,
  TargetBox,
} from "./types";

export type DemoStageProps<S, A> = {
  scene: DemoScene<S, A>;
  /** The visible caption under the stage. */
  caption: ReactNode;
  /** What the demo shows, for screen readers (the moving parts are hidden). */
  description: string;
  /** The design size the scene is laid out at; the stage scales it to fit. */
  size?: StageSize;
  /** A second design size for narrow containers (phones). */
  compactSize?: StageSize;
  /** Container width (CSS px) below which `compactSize` applies. */
  compactBelow?: number;
  /** The name tag of the collaborator cursor; omit when unused. */
  collaborator?: string;
  loop?: boolean;
  /** The pause before the next loop, in ms. */
  loopDelay?: number;
  /** Show the play / pause / replay button. */
  controls?: boolean;
  className?: string;
};

type Message<S, A> =
  | { type: "reset"; state: S }
  | { type: "action"; action: A };

type Mode = "auto" | "stopped";

const DEFAULT_SIZE: StageSize = { width: 1280, height: 800 };

function cursorFor(element: Element): CursorKind | undefined {
  const declared = (element as HTMLElement).dataset?.demoCursor;
  if (declared === "pointer" || declared === "grab" || declared === "text") {
    return declared;
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return "text";
  }
  return undefined;
}

/**
 * Renders a scene in a scaled, fixed-aspect window and plays its script
 * with a scripted cursor. It plays only while on screen and the tab is
 * visible, loops, stops for good once the visitor interacts (the replica
 * then works by hand), and shows the final still frame with reduced motion.
 */
export function DemoStage<S, A>({
  scene,
  caption,
  description,
  size = DEFAULT_SIZE,
  compactSize,
  compactBelow = 640,
  collaborator,
  loop = true,
  loopDelay = 2600,
  controls = true,
  className,
}: DemoStageProps<S, A>) {
  const labels = useLandingCopy().demo.controls;
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const mainCursorRef = useRef<HTMLDivElement>(null);
  const collabCursorRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const playingRef = useRef(false);

  const reduced = useReducedMotion();
  const inView = useInView(frameRef);
  const tabVisible = useTabVisible();
  const width = useWidth(frameRef);
  const compact = !!compactSize && width > 0 && width < compactBelow;
  const design = compact && compactSize ? compactSize : size;
  const scale = width > 0 ? width / design.width : 1;

  const [mode, setMode] = useState<Mode>("auto");
  const [userPaused, setUserPaused] = useState(false);
  const [runId, setRunId] = useState(0);
  const [hint, setHint] = useState<{ combo: string; visible: boolean }>({
    combo: "",
    visible: false,
  });

  const finalState = useMemo(() => finalStateOf(scene), [scene]);
  const [state, send] = useReducer(
    (current: S, message: Message<S, A>) =>
      message.type === "reset"
        ? message.state
        : scene.reducer(current, message.action),
    scene.initialState,
  );

  const autoplay = !reduced && mode === "auto";
  const playing = autoplay && !userPaused && inView && tabVisible;

  // Reduced motion: the final still frame, no cursor.
  useEffect(() => {
    if (reduced) send({ type: "reset", state: finalState });
  }, [reduced, finalState]);

  // The script: one run per scene, layout, replay or takeover change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runId and compact restart the run on purpose.
  useEffect(() => {
    if (!autoplay) return;
    const timeline = createTimeline();
    timelineRef.current = timeline;
    const lifted = new Map<
      string,
      { clone: HTMLElement; source: HTMLElement }
    >();

    const query = (target: string) =>
      canvasRef.current?.querySelector<HTMLElement>(
        `[data-demo="${target}"]`,
      ) ?? null;
    const unscale = () => {
      const canvas = canvasRef.current;
      if (!canvas?.offsetWidth) return 1;
      return canvas.getBoundingClientRect().width / canvas.offsetWidth || 1;
    };
    const locate = (target: string): TargetBox | null => {
      const canvas = canvasRef.current;
      const element = query(target);
      if (!canvas || !element) return null;
      const origin = canvas.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      const s = unscale();
      return {
        x: (box.left - origin.left) / s,
        y: (box.top - origin.top) / s,
        width: box.width / s,
        height: box.height / s,
        cursor: cursorFor(element),
      };
    };
    const cursorElement = (id: CursorId) =>
      id === "main" ? mainCursorRef.current : collabCursorRef.current;

    const host: DemoHost<A> = {
      dispatch: (action) => send({ type: "action", action }),
      reset: () => send({ type: "reset", state: scene.initialState }),
      locate,
      cursor: (id, frame: CursorFrame) => {
        const element = cursorElement(id);
        if (!element) return;
        element.style.transform = `translate3d(${frame.x}px, ${frame.y}px, 0)`;
        element.dataset.kind = frame.kind;
        element.dataset.pressed = String(frame.pressed);
        element.dataset.visible = String(frame.visible);
      },
      ripple: (_id, at: Point) => {
        const layer = overlayRef.current;
        if (!layer) return;
        const ring = document.createElement("span");
        ring.className =
          "pointer-events-none absolute size-10 rounded-full border-2 border-primary/60 bg-primary/10";
        ring.style.left = `${at.x - 20}px`;
        ring.style.top = `${at.y - 20}px`;
        layer.appendChild(ring);
        if (typeof ring.animate === "function") {
          const animation = ring.animate(
            [
              { transform: "scale(0.3)", opacity: 0.9 },
              { transform: "scale(1.5)", opacity: 0 },
            ],
            { duration: 520, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
          );
          animation.onfinish = () => ring.remove();
        } else {
          setTimeout(() => ring.remove(), 520);
        }
      },
      hint: (combo) =>
        setHint((previous) =>
          combo === null
            ? { ...previous, visible: false }
            : { combo, visible: true },
        ),
      lift: (target, offset) => {
        const entry = lifted.get(target);
        if (offset === null) {
          if (entry) {
            entry.clone.remove();
            entry.source.style.opacity = "";
            lifted.delete(target);
          }
          return;
        }
        let current = entry;
        if (!current) {
          const source = query(target);
          const box = locate(target);
          const layer = overlayRef.current;
          if (!source || !box || !layer) return;
          const clone = source.cloneNode(true) as HTMLElement;
          clone.removeAttribute("data-demo");
          for (const node of clone.querySelectorAll("[data-demo]")) {
            node.removeAttribute("data-demo");
          }
          Object.assign(clone.style, {
            position: "absolute",
            left: `${box.x}px`,
            top: `${box.y}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
            margin: "0",
          });
          clone.classList.add("shadow-lg", "ring-2", "ring-ring/35");
          layer.appendChild(clone);
          source.style.opacity = "0.4";
          current = { clone, source };
          lifted.set(target, current);
        }
        current.clone.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0) rotate(2deg) scale(1.02)`;
      },
      scroll: (target) => {
        const element = query(target);
        const container = element?.closest<HTMLElement>("[data-demo-scroll]");
        if (!element || !container) return null;
        const s = unscale();
        const outer = container.getBoundingClientRect();
        const inner = element.getBoundingClientRect();
        const pad = 16;
        const delta = (start: number, end: number, from: number, to: number) =>
          start < from
            ? (start - from) / s - pad
            : end > to
              ? (end - to) / s + pad
              : 0;
        const from = { x: container.scrollLeft, y: container.scrollTop };
        const clamp = (value: number, max: number) =>
          Math.max(0, Math.min(value, Math.max(0, max)));
        const to = {
          x: clamp(
            from.x + delta(inner.left, inner.right, outer.left, outer.right),
            container.scrollWidth - container.clientWidth,
          ),
          y: clamp(
            from.y + delta(inner.top, inner.bottom, outer.top, outer.bottom),
            container.scrollHeight - container.clientHeight,
          ),
        };
        return {
          from,
          to,
          apply: (position) => {
            container.scrollLeft = position.x;
            container.scrollTop = position.y;
          },
        };
      },
    };

    if (playingRef.current) timeline.play();
    const canvas = canvasRef.current;
    const home = canvas
      ? { x: canvas.offsetWidth * 0.82, y: canvas.offsetHeight * 0.86 }
      : { x: design.width * 0.82, y: design.height * 0.86 };
    runScript({
      steps: scene.script,
      host,
      timeline,
      home,
      collabHome: { x: home.x * 0.4, y: home.y * 0.3 },
      loop,
      loopDelay,
    }).catch((error: unknown) => {
      console.error(error);
    });

    return () => {
      timeline.cancel();
      timelineRef.current = null;
      for (const { clone, source } of lifted.values()) {
        clone.remove();
        source.style.opacity = "";
      }
      lifted.clear();
      for (const element of [mainCursorRef.current, collabCursorRef.current]) {
        if (element) element.dataset.visible = "false";
      }
      setHint((previous) => ({ ...previous, visible: false }));
    };
  }, [autoplay, scene, loop, loopDelay, runId, compact]);

  // Play only while wanted, on screen and in a visible tab.
  useEffect(() => {
    playingRef.current = playing;
    if (playing) timelineRef.current?.play();
    else timelineRef.current?.pause();
  }, [playing]);

  const takeOver = () => {
    if (autoplay) {
      setMode("stopped");
      setUserPaused(false);
    }
  };

  const replay = () => {
    setMode("auto");
    setUserPaused(false);
    setRunId((id) => id + 1);
  };

  const control = reduced
    ? null
    : mode === "stopped"
      ? { label: labels.replay, icon: RotateCcw, onClick: replay }
      : userPaused
        ? {
            label: labels.play,
            icon: Play,
            onClick: () => setUserPaused(false),
          }
        : {
            label: labels.pause,
            icon: Pause,
            onClick: () => setUserPaused(true),
          };

  return (
    <figure className={cn("m-0 w-full", className)} data-demo-stage={scene.id}>
      <p className="sr-only">{description}</p>
      <div
        ref={frameRef}
        className="relative isolate w-full overflow-hidden rounded-xl border border-border bg-background shadow-xs"
        style={{ aspectRatio: `${design.width} / ${design.height}` }}
      >
        {/* The canvas is laid out at the design size and scaled to fit. */}
        <div
          ref={canvasRef}
          data-demo-canvas=""
          data-mode={mode}
          className={cn(
            "absolute top-0 left-0 origin-top-left overflow-hidden transition-opacity duration-300",
            width > 0 ? "opacity-100" : "opacity-0",
          )}
          style={
            {
              width: design.width,
              height: design.height,
              transform: `scale(${scale})`,
              // Design px that keep replica toasts clear of the unscaled controls.
              "--demo-controls-inset": controls
                ? `${Math.ceil(56 / scale)}px`
                : "1rem",
            } as CSSProperties
          }
          // The script never fires DOM events, so any pointer is the visitor.
          onPointerDownCapture={takeOver}
          onFocusCapture={takeOver}
        >
          <div className="h-full w-full" inert={autoplay && !userPaused}>
            {scene.render({
              state,
              dispatch: (action: A) => send({ type: "action", action }),
              interactive: !autoplay,
              compact,
            })}
          </div>
          <div
            ref={overlayRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 z-40"
          />
          {!reduced && <DemoCursor ref={mainCursorRef} />}
          {!reduced && collaborator && (
            <CollaboratorCursor ref={collabCursorRef} name={collaborator} />
          )}
          <KeyHint combo={hint.combo} visible={hint.visible} />
        </div>

        {controls && control && (
          <div className="absolute right-3 bottom-3 z-50 flex items-center gap-2">
            {mode === "stopped" && (
              <span
                role="status"
                className="rounded-full border border-border bg-popover/95 px-2.5 py-1 text-popover-foreground text-xs shadow-sm"
              >
                {labels.yourTurn}
              </span>
            )}
            <button
              type="button"
              aria-label={control.label}
              title={control.label}
              onClick={control.onClick}
              className="flex size-8 cursor-pointer items-center justify-center rounded-full border border-border bg-popover/95 text-muted-foreground shadow-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <control.icon aria-hidden className="size-3.5" />
            </button>
          </div>
        )}
      </div>
      <figcaption className="mt-3 text-center text-muted-foreground text-sm">
        {caption}
      </figcaption>
    </figure>
  );
}
