import type { Editor } from "@tiptap/core";
import { useEffect, useMemo, useState } from "react";
import {
  type OutlineHeading,
  outlineFromDoc,
} from "@/lib/pages/editor-document";
import { useEditorRevision } from "./use-editor-revision";

/** How far below the canvas top a heading still counts as "in view". */
const ACTIVE_OFFSET_PX = 120;

/** Scrolls to a heading, centres it and puts the caret inside. */
export function jumpToHeading(editor: Editor | null, heading: OutlineHeading) {
  if (!editor || editor.isDestroyed) return;
  editor
    .chain()
    .focus()
    .setTextSelection(heading.pos + 1)
    .run();
  const dom = editor.view.nodeDOM(heading.pos);
  if (dom instanceof HTMLElement) {
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    dom.scrollIntoView({
      block: "center",
      behavior: reduce ? "auto" : "smooth",
    });
  }
}

/**
 * The live document's H1-H3 headings, and the one the reader is in: the
 * last heading at or above the top of the page canvas.
 */
export function usePageHeadings(editor: Editor | null) {
  const revision = useEditorRevision(editor);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision tracks document changes
  const headings = useMemo(
    () =>
      editor && !editor.isDestroyed ? outlineFromDoc(editor.state.doc) : [],
    [editor, revision],
  );
  const [activePos, setActivePos] = useState<number | null>(null);

  useEffect(() => {
    if (!editor || editor.isDestroyed || headings.length === 0) {
      setActivePos(null);
      return;
    }
    const canvas = editor.view.dom.closest<HTMLElement>(
      '[data-slot="page-canvas"]',
    );
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (editor.isDestroyed) return;
      const top = canvas?.getBoundingClientRect().top ?? 0;
      let active = headings[0]?.pos ?? null;
      for (const heading of headings) {
        const dom = editor.view.nodeDOM(heading.pos);
        if (!(dom instanceof HTMLElement)) continue;
        if (dom.getBoundingClientRect().top - top <= ACTIVE_OFFSET_PX) {
          active = heading.pos;
        } else {
          break;
        }
      }
      setActivePos(active);
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    canvas?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      canvas?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [editor, headings]);

  return { headings, activePos };
}
