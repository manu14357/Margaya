import { useCallback, useEffect, useRef, useState } from "react";

export const STICKY_SAVE_DELAY_MS = 800;

export type StickySaveStatus = "idle" | "saving" | "error";

type Options = {
  /** The content the cache holds (server or optimistic). */
  serverContent: string;
  save: (content: string) => Promise<unknown>;
  /** Called once per failure streak. */
  onSaveError: () => void;
};

/**
 * A sticky's local draft and its autosave. The draft is the source of truth
 * while editing: it saves 800 ms after the last change and at once on blur
 * and on unmount, one save in flight at a time. Only changes made while the
 * editor has focus count, and nothing is written unless the draft differs
 * from the last saved content. Server content replaces the draft only while
 * the editor is not focused and nothing is unsaved.
 */
export function useStickyAutosave({
  serverContent,
  save,
  onSaveError,
}: Options) {
  const [draft, setDraftState] = useState(serverContent);
  const [status, setStatus] = useState<StickySaveStatus>("idle");

  const draftRef = useRef(serverContent);
  const savedRef = useRef(serverContent);
  const serverRef = useRef(serverContent);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const focusedRef = useRef(false);
  const cancelledRef = useRef(false);
  const failingRef = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;
  const onSaveErrorRef = useRef(onSaveError);
  onSaveErrorRef.current = onSaveError;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const adoptServerIfIdle = useCallback(() => {
    if (
      focusedRef.current ||
      inFlightRef.current ||
      timerRef.current !== null ||
      draftRef.current !== savedRef.current ||
      serverRef.current === draftRef.current
    ) {
      return;
    }
    draftRef.current = serverRef.current;
    savedRef.current = serverRef.current;
    setDraftState(serverRef.current);
  }, []);

  const flush = useCallback(() => {
    if (cancelledRef.current) return;
    clearTimer();
    if (inFlightRef.current) return;
    const content = draftRef.current;
    if (content === savedRef.current) return;

    inFlightRef.current = true;
    setStatus("saving");
    saveRef.current(content).then(
      () => {
        inFlightRef.current = false;
        savedRef.current = content;
        failingRef.current = false;
        if (cancelledRef.current) return;
        if (draftRef.current !== savedRef.current) {
          // Changes made during the flight go right after it, unless the
          // debounce is still waiting for the typing to stop.
          if (timerRef.current === null) flush();
          else setStatus("idle");
          return;
        }
        setStatus("idle");
        adoptServerIfIdle();
      },
      () => {
        inFlightRef.current = false;
        if (cancelledRef.current) return;
        setStatus("error");
        if (!failingRef.current) {
          failingRef.current = true;
          onSaveErrorRef.current();
        }
      },
    );
  }, [adoptServerIfIdle, clearTimer]);

  const setDraft = useCallback(
    (value: string) => {
      // Only someone typing in the sticky edits it. An editor can report a
      // change on its own while it loads content (an empty document at
      // first); saving that would wipe the note, so it is never a draft.
      if (!focusedRef.current) return;
      draftRef.current = value;
      setDraftState(value);
      clearTimer();
      if (value === savedRef.current && !inFlightRef.current) {
        setStatus("idle");
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flush();
      }, STICKY_SAVE_DELAY_MS);
    },
    [clearTimer, flush],
  );

  useEffect(() => {
    serverRef.current = serverContent;
    adoptServerIfIdle();
  }, [serverContent, adoptServerIfIdle]);

  const onFocus = useCallback(() => {
    focusedRef.current = true;
  }, []);

  const onBlur = useCallback(() => {
    focusedRef.current = false;
    flush();
    adoptServerIfIdle();
  }, [adoptServerIfIdle, flush]);

  /** Stops saving for good, for a sticky being deleted. */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
  }, [clearTimer]);

  // Best effort: an unsaved draft is sent when the card goes away.
  useEffect(() => flush, [flush]);

  return { draft, setDraft, status, flush, onFocus, onBlur, cancel };
}
