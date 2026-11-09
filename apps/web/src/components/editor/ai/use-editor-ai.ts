import type { Editor, EditorEvents } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AiUiLocale,
  type EditorAiAction,
  type EditorAiTargetKind,
  type EditorAiTone,
  type EditorAssistRequest,
  streamEditorAssist,
} from "@/fetchers/ai/writing";
import { useAiTextStream } from "@/hooks/use-ai-text-stream";
import {
  type EditorAiRange,
  insertSuggestionBelow,
  mapRange,
  rangeMarkdown,
  replaceWithSuggestion,
} from "./editor-ai-apply";
import { useAiLocale } from "./use-ai-locale";

export type EditorAiTarget = {
  kind: Exclude<EditorAiTargetKind, "new_task">;
  id: string;
};

export const EDITOR_AI_TONES = [
  "default",
  "professional",
  "casual",
] as const satisfies readonly EditorAiTone[];

/** Actions a tone preset applies to; the others ignore it. */
export const TONED_ACTIONS: ReadonlySet<EditorAiAction> = new Set([
  "improve",
  "shorter",
  "longer",
  "custom",
]);

const TONE_STORAGE_KEY = "margaya:editor-ai-tone";

function storedTone(): EditorAiTone {
  try {
    const value = window.localStorage.getItem(TONE_STORAGE_KEY);
    return (EDITOR_AI_TONES as readonly string[]).includes(value ?? "")
      ? (value as EditorAiTone)
      : "default";
  } catch {
    return "default";
  }
}

/** The person's tone preset, remembered in this browser. */
export function useEditorAiTone() {
  const [tone, setToneState] = useState<EditorAiTone>(storedTone);
  const setTone = useCallback((next: EditorAiTone) => {
    setToneState(next);
    try {
      window.localStorage.setItem(TONE_STORAGE_KEY, next);
    } catch {
      // Private mode: the preset lasts for this page only.
    }
  }, []);
  return [tone, setTone] as const;
}

/** The request body's tone, when the action takes one. */
export function toneFor(
  action: EditorAiAction,
  tone: EditorAiTone | undefined,
): EditorAiTone | undefined {
  return tone && tone !== "default" && TONED_ACTIONS.has(action)
    ? tone
    : undefined;
}

export type EditorAiRequest = {
  action: EditorAiAction;
  language?: AiUiLocale;
  instruction?: string;
  /** Defaults to the person's tone preset. */
  tone?: EditorAiTone;
};

export type EditorAiSession = {
  request: EditorAiRequest | null;
  /** The passage the suggestion is for, kept in step with edits. */
  range: EditorAiRange;
  text: string;
  /** False once co-editors removed the passage: only inserting remains. */
  rangeIntact: boolean;
};

/** The caller's UI language, when it is one the API answers in. */
export { useAiLocale };

/**
 * Editor block AI: run an action on a selection or block, stream the
 * suggestion into a preview, then replace, insert below or discard. Nothing
 * reaches the document until the person picks Replace or Insert below.
 */
export function useEditorAi({
  editor,
  workspaceId,
  target,
}: {
  editor: Editor | null;
  workspaceId: string;
  target: EditorAiTarget | null;
}) {
  const locale = useAiLocale();
  const stream = useAiTextStream();
  const [tone, setTone] = useEditorAiTone();
  const toneRef = useRef(tone);
  toneRef.current = tone;
  const [session, setSession] = useState<EditorAiSession | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const active = session !== null;

  // Follow the passage through local and remote edits.
  useEffect(() => {
    if (!editor || !active) return;
    const onTransaction = ({ transaction }: EditorEvents["transaction"]) => {
      if (!transaction.docChanged) return;
      setSession((current) => {
        if (!current) return current;
        const range = mapRange(current.range, transaction);
        return {
          ...current,
          range,
          rangeIntact: current.rangeIntact && range.to > range.from,
        };
      });
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor, active]);

  const run = useCallback(
    (request: EditorAiRequest, range: EditorAiRange, text: string) => {
      if (!target) return;
      setSession({ request, range, text, rangeIntact: true });
      const requestTone = toneFor(
        request.action,
        request.tone ?? toneRef.current,
      );
      const body: EditorAssistRequest = {
        workspaceId,
        target,
        action: request.action,
        text,
        ...(request.language ? { language: request.language } : {}),
        ...(request.instruction ? { instruction: request.instruction } : {}),
        ...(requestTone ? { tone: requestTone } : {}),
        ...(locale ? { locale } : {}),
      };
      void stream.start((handlers) => streamEditorAssist(body, handlers));
    },
    [locale, stream.start, target, workspaceId],
  );

  /** The current selection (or `range`), if it holds any text. */
  const capture = useCallback(
    (range?: EditorAiRange) => {
      if (!editor || editor.isDestroyed) return null;
      const { from, to } = range ?? editor.state.selection;
      if (to <= from) return null;
      const text = rangeMarkdown(editor, { from, to });
      return text ? { range: { from, to }, text } : null;
    },
    [editor],
  );

  /**
   * Starts an action on the selection or the given range. "custom" without
   * an instruction opens the preview to ask for one first.
   */
  const begin = useCallback(
    (request: EditorAiRequest, range?: EditorAiRange) => {
      const captured = capture(range);
      if (!captured) return;
      if (request.action === "custom" && !request.instruction) {
        stream.reset();
        setSession({
          request: null,
          range: captured.range,
          text: captured.text,
          rangeIntact: true,
        });
        return;
      }
      run(request, captured.range, captured.text);
    },
    [capture, run, stream.reset],
  );

  /** Runs the custom instruction typed into the preview. */
  const ask = useCallback(
    (instruction: string) => {
      const current = sessionRef.current;
      const trimmed = instruction.trim();
      if (!current || !trimmed) return;
      run(
        { action: "custom", instruction: trimmed },
        current.range,
        current.text,
      );
    },
    [run],
  );

  const retry = useCallback(() => {
    const current = sessionRef.current;
    if (current?.request) run(current.request, current.range, current.text);
  }, [run]);

  /** Changes the tone preset and, for a toned suggestion, rewrites it. */
  const changeTone = useCallback(
    (next: EditorAiTone) => {
      setTone(next);
      const current = sessionRef.current;
      if (current?.request && TONED_ACTIONS.has(current.request.action)) {
        run({ ...current.request, tone: next }, current.range, current.text);
      }
    },
    [run, setTone],
  );

  const discard = useCallback(() => {
    stream.reset();
    setSession(null);
    editor?.commands.focus();
  }, [editor, stream.reset]);

  const apply = useCallback(
    (mode: "replace" | "below", markdown: string) => {
      const current = sessionRef.current;
      if (!editor || !current || !markdown.trim()) return false;
      const applied =
        mode === "replace" && current.rangeIntact
          ? replaceWithSuggestion(editor, current.range, markdown)
          : insertSuggestionBelow(editor, current.range, markdown);
      if (applied) {
        stream.reset();
        setSession(null);
      }
      return applied;
    },
    [editor, stream.reset],
  );

  return {
    workspaceId,
    session,
    tone,
    setTone,
    changeTone,
    meta: stream.meta,
    status: stream.status,
    suggestion: stream.text,
    setSuggestion: stream.setText,
    errorKey: stream.errorKey,
    begin,
    ask,
    retry,
    stop: stream.stop,
    discard,
    apply,
  };
}

export type EditorAi = ReturnType<typeof useEditorAi>;
