import type { Editor } from "@tiptap/core";
import { ArrowDownToLine, Replace, Sparkles, X } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import { useEffect, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import AiFeedbackButtons from "./ai-feedback-buttons";
import { editorAiActionKey } from "./editor-ai-menu";
import { EditorAiToneSwitch } from "./editor-ai-tone-switch";
import { type EditorAi, TONED_ACTIONS } from "./use-editor-ai";

type EditorAiPreviewProps = {
  editor: Editor;
  ai: EditorAi;
  /** The positioned editor shell the preview is placed in. */
  shellRef: RefObject<HTMLElement | null>;
};

/**
 * The suggestion under the passage: it streams in, can be edited, and only
 * reaches the document through Replace or Insert below. Escape discards.
 */
export default function EditorAiPreview({
  editor,
  ai,
  shellRef,
}: EditorAiPreviewProps) {
  const { t } = useTranslation();
  const { session, status, suggestion } = ai;
  const [top, setTop] = useState<number | null>(null);
  const [instruction, setInstruction] = useState("");
  const rangeEnd = session?.range.to ?? null;

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (rangeEnd === null || !shell || editor.isDestroyed) return;
    const place = () => {
      try {
        const end = Math.min(rangeEnd, editor.state.doc.content.size);
        const coords = editor.view.coordsAtPos(end);
        setTop(coords.bottom - shell.getBoundingClientRect().top + 8);
      } catch {
        setTop(null);
      }
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [editor, rangeEnd, shellRef]);

  useEffect(() => {
    if (session && !session.request) setInstruction("");
  }, [session]);

  if (!session) return null;

  const asking = session.request === null;
  const title = session.request
    ? session.request.action === "custom"
      ? session.request.instruction
      : t(editorAiActionKey(session.request.action))
    : t("ai:writing.actions.custom");

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      ai.discard();
    }
  };

  return (
    <section
      aria-label={t("ai:writing.preview.label")}
      className="absolute inset-x-0 z-30 mx-auto max-w-2xl rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg/5"
      style={{ top: top ?? "100%" }}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-2">
        <Sparkles
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {title}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("ai:writing.preview.discard")}
          title={t("ai:writing.preview.discard")}
          onClick={ai.discard}
        >
          <X />
        </Button>
      </div>

      {asking ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            ai.ask(instruction);
          }}
        >
          <Input
            size="sm"
            autoFocus
            value={instruction}
            maxLength={500}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={t("ai:writing.customPlaceholder")}
            aria-label={t("ai:writing.actions.custom")}
          />
          <Button type="submit" size="xs" disabled={!instruction.trim()}>
            {t("ai:writing.customSubmit")}
          </Button>
        </form>
      ) : status === "error" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p
            role="alert"
            className="flex-1 text-destructive-foreground text-sm"
          >
            {t(ai.errorKey ?? "ai:errors.unknown")}
          </p>
          <Button type="button" size="xs" variant="outline" onClick={ai.retry}>
            {t("ai:writing.preview.retry")}
          </Button>
        </div>
      ) : (
        <>
          {status === "streaming" ? (
            <div
              aria-live="polite"
              aria-busy="true"
              className="max-h-64 min-h-10 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 px-2.5 py-2 text-sm"
            >
              {suggestion || (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Spinner className="size-3.5" />
                  {t("ai:writing.preview.generating")}
                </span>
              )}
            </div>
          ) : (
            <Textarea
              size="sm"
              aria-label={t("ai:writing.preview.editLabel")}
              className="max-h-64"
              value={suggestion}
              onChange={(event) => ai.setSuggestion(event.target.value)}
            />
          )}
          {status === "done" && !suggestion.trim() && (
            <p className="mt-2 text-muted-foreground text-xs">
              {t("ai:writing.preview.empty")}
            </p>
          )}
          {session.request &&
            TONED_ACTIONS.has(session.request.action) &&
            status !== "streaming" && (
              <EditorAiToneSwitch
                className="mt-2"
                value={session.request.tone ?? ai.tone}
                onChange={ai.changeTone}
              />
            )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {status === "streaming" ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={ai.stop}
              >
                {t("ai:writing.preview.stop")}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  size="xs"
                  disabled={!suggestion.trim() || !session.rangeIntact}
                  onClick={() => ai.apply("replace", suggestion)}
                >
                  <Replace />
                  {t("ai:writing.preview.replace")}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={!suggestion.trim()}
                  onClick={() => ai.apply("below", suggestion)}
                >
                  <ArrowDownToLine />
                  {t("ai:writing.preview.insertBelow")}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={ai.retry}
                >
                  {t("ai:writing.preview.retry")}
                </Button>
              </>
            )}
            {status === "done" && suggestion.trim() && (
              <AiFeedbackButtons
                workspaceId={ai.workspaceId}
                feature="editor_assist"
                meta={ai.meta}
                answerKey={ai.meta}
              />
            )}
            <span className="ms-auto text-muted-foreground text-xs">
              {t("ai:writing.preview.note")}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
