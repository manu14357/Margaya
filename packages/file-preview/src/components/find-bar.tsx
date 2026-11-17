import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from "react";
import { usePreview } from "../context";
import { formatLabel } from "../labels";
import { IconButton } from "./ui";

/**
 * Find in the file: a query box with the match count and next/previous.
 * Enter goes to the next match, Shift+Enter to the previous one, Escape
 * closes the bar.
 */
export function FindBar({
  query,
  onQuery,
  total,
  current,
  onStep,
  onClose,
  busy = false,
}: {
  query: string;
  onQuery: (query: string) => void;
  total: number;
  /** Index of the current match, or -1. */
  current: number;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const { labels } = usePreview();
  const inputRef = useRef<HTMLInputElement>(null);
  const statusId = useId();
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (total > 0) onStep(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  const status =
    query.trim().length === 0 || busy
      ? ""
      : total === 0
        ? labels.findNone
        : formatLabel(labels.findCount, {
            current: Math.max(current, 0) + 1,
            total,
          });

  return (
    <search className="mfp-find">
      <Search className="mfp-find-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className="mfp-find-input"
        value={query}
        placeholder={labels.findPlaceholder}
        aria-label={labels.find}
        aria-describedby={statusId}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoComplete="off"
      />
      <span id={statusId} className="mfp-find-status" aria-live="polite">
        {status}
      </span>
      <IconButton
        label={labels.findPrevious}
        disabled={total === 0}
        onClick={() => onStep(-1)}
      >
        <ChevronUp aria-hidden="true" />
      </IconButton>
      <IconButton
        label={labels.findNext}
        disabled={total === 0}
        onClick={() => onStep(1)}
      >
        <ChevronDown aria-hidden="true" />
      </IconButton>
      <IconButton label={labels.findClose} onClick={onClose}>
        <X aria-hidden="true" />
      </IconButton>
    </search>
  );
}

/**
 * Ctrl/Cmd+F inside the preview opens its find bar instead of the
 * browser's, which can't see canvas or virtualised rows.
 */
export function useFindShortcut(
  rootRef: RefObject<HTMLElement | null>,
  open: () => void,
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        open();
      }
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [rootRef, open]);
}

/** Next or previous index in a ring of `total`, from `current` (-1 = none). */
export function stepIndex(
  current: number,
  total: number,
  direction: 1 | -1,
): number {
  if (total <= 0) return -1;
  if (current < 0) return direction > 0 ? 0 : total - 1;
  return (current + direction + total) % total;
}
