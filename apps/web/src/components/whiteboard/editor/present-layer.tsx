// Reads the board controller's scene while rendering; the controller is a
// mutable object whose identity never changes, so compiler memoisation would
// freeze those reads.
"use no memo";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { type BoardController, unionBounds } from "./controller";
import {
  type PresentStep,
  presentationFrames,
  presentKeyAction,
  stepPresentation,
} from "./present";
import { useEditorState } from "./use-editor";
import { fitRect } from "./viewport";

/** Screen pixels around a frame in present mode (no toolbars to clear). */
const FRAME_PADDING = 24;
const BOARD_PADDING = 48;
/** Board units above a frame taken by its name. */
const FRAME_NAME_SPACE = 26;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Present mode over the canvas: shows one frame at a time (or the whole
 * board when it has no frames). Arrow keys or a click move between frames,
 * Esc exits. It covers the canvas, so nothing on the board can be edited.
 */
export function PresentLayer({
  controller: c,
  onExit,
}: {
  controller: BoardController;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const width = useEditorState((state) => state.width);
  const height = useEditorState((state) => state.height);
  useEditorState((state) => state.sceneVersion);
  const [index, setIndex] = useState(0);

  const frames = presentationFrames(c.scene.elements);
  const count = frames.length;
  const current = count > 0 ? Math.min(index, count - 1) : 0;
  const target = count > 0 ? frames[current] : undefined;
  const frameBox = target ? unionBounds([target]) : null;
  // A frame's name is drawn above it (14 px text plus its gap, in board
  // units), so the fitted area includes it or the name is cut off.
  const box = frameBox
    ? target?.type === "frame" && target.name.trim()
      ? {
          ...frameBox,
          y: frameBox.y - FRAME_NAME_SPACE,
          height: frameBox.height + FRAME_NAME_SPACE,
        }
      : frameBox
    : unionBounds(c.scene.elements);
  // The view only moves when what it shows (or the screen) changes, so edits
  // elsewhere on the board leave it alone.
  const viewKey = box
    ? `${box.x},${box.y},${box.width},${box.height},${target?.id ?? ""}`
    : "";
  const boxRef = useRef(box);
  boxRef.current = box;

  const showsFrame = Boolean(target);

  useEffect(() => {
    const shown = boxRef.current;
    if (!viewKey || !shown || width === 0 || height === 0) return;
    c.setViewport(
      fitRect(shown, width, height, {
        padding: showsFrame ? FRAME_PADDING : BOARD_PADDING,
        maxZoom: showsFrame ? 4 : 1,
      }),
    );
  }, [c, viewKey, width, height, showsFrame]);

  const go = (step: PresentStep) =>
    setIndex((value) => stepPresentation(value, count, step));
  const goRef = useRef(go);
  goRef.current = go;
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // Enter and Space press a focused control (Exit, Next) as usual.
      if (
        (event.key === "Enter" || event.key === " ") &&
        event.target instanceof HTMLElement &&
        event.target.closest("button")
      )
        return;
      const action = presentKeyAction(event.key);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "exit") exitRef.current();
      else goRef.current(action);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div className="absolute inset-0 z-40" data-testid="whiteboard-present">
      {/* The whole canvas is the "next" button; Shift or a right click goes back. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("whiteboards:present.next")}
        className="absolute inset-0 size-full cursor-default outline-none"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => go(event.shiftKey ? "previous" : "next")}
        onContextMenu={(event) => {
          event.preventDefault();
          go("previous");
        }}
      />
      <nav
        aria-label={t("whiteboards:present.controls")}
        className="absolute right-3 bottom-3 flex items-center gap-1 rounded-xl border bg-card/90 p-0.5 opacity-60 shadow-lg/5 transition-opacity duration-150 focus-within:opacity-100 hover:opacity-100 motion-reduce:transition-none"
      >
        {count > 1 && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              className="pointer-coarse:size-11"
              aria-label={t("whiteboards:present.previous")}
              disabled={current === 0}
              onClick={() => go("previous")}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <output
              aria-live="polite"
              className="min-w-12 text-center text-muted-foreground text-xs tabular-nums"
            >
              {t("whiteboards:present.position", {
                current: current + 1,
                total: count,
              })}
            </output>
            <Button
              variant="ghost"
              size="icon-sm"
              className="pointer-coarse:size-11"
              aria-label={t("whiteboards:present.next")}
              disabled={current === count - 1}
              onClick={() => go("next")}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-coarse:size-11"
          aria-label={t("whiteboards:present.exit")}
          title={t("whiteboards:present.exit")}
          onClick={onExit}
        >
          <X aria-hidden="true" />
        </Button>
      </nav>
    </div>
  );
}
