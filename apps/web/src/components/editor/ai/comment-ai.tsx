import { Replace, Sparkles, X } from "lucide-react";
import { type KeyboardEvent, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  type EditorAssistRequest,
  streamEditorAssist,
} from "@/fetchers/ai/writing";
import { useAiTextStream } from "@/hooks/use-ai-text-stream";
import AiFeedbackButtons from "./ai-feedback-buttons";
import { EditorAiMenuItems, editorAiActionKey } from "./editor-ai-menu";
import { EditorAiToneSwitch } from "./editor-ai-tone-switch";
import {
  type EditorAiRequest,
  TONED_ACTIONS,
  toneFor,
  useAiLocale,
  useEditorAiTone,
} from "./use-editor-ai";

/** The API's cap on the passage. */
const MAX_DRAFT_CHARS = 20_000;

/**
 * AI on a comment being written: the editor AI actions run on the whole
 * draft, the suggestion streams into a preview under the composer, and only
 * "Replace draft" changes it. Nothing is posted by AI.
 */
export function useCommentAi({
  workspaceId,
  taskId,
  getDraft,
  onApply,
}: {
  workspaceId: string;
  taskId: string;
  getDraft: () => string;
  onApply: (markdown: string) => void;
}) {
  const locale = useAiLocale();
  const stream = useAiTextStream();
  const [tone, setTone] = useEditorAiTone();
  const [request, setRequest] = useState<EditorAiRequest | null>(null);
  const [asking, setAsking] = useState(false);
  const sourceRef = useRef("");

  const run = useCallback(
    (next: EditorAiRequest, source = sourceRef.current) => {
      if (!source.trim()) return;
      sourceRef.current = source;
      setAsking(false);
      setRequest(next);
      const requestTone = toneFor(next.action, next.tone ?? tone);
      const body: EditorAssistRequest = {
        workspaceId,
        target: { kind: "comment_draft", id: taskId },
        action: next.action,
        text: source.slice(0, MAX_DRAFT_CHARS),
        ...(next.language ? { language: next.language } : {}),
        ...(next.instruction ? { instruction: next.instruction } : {}),
        ...(requestTone ? { tone: requestTone } : {}),
        ...(locale ? { locale } : {}),
      };
      void stream.start((handlers) => streamEditorAssist(body, handlers));
    },
    [locale, stream.start, taskId, tone, workspaceId],
  );

  const begin = useCallback(
    (next: EditorAiRequest) => {
      const draft = getDraft().trim();
      if (!draft) return;
      sourceRef.current = draft;
      if (next.action === "custom" && !next.instruction) {
        stream.reset();
        setRequest(null);
        setAsking(true);
        return;
      }
      run(next, draft);
    },
    [getDraft, run, stream.reset],
  );

  const discard = useCallback(() => {
    stream.reset();
    setRequest(null);
    setAsking(false);
  }, [stream.reset]);

  const apply = useCallback(() => {
    if (!stream.text.trim()) return;
    onApply(stream.text.trim());
    discard();
  }, [discard, onApply, stream.text]);

  return {
    workspaceId,
    request,
    asking,
    open: asking || request !== null,
    tone,
    setTone,
    changeTone: (next: typeof tone) => {
      setTone(next);
      if (request && TONED_ACTIONS.has(request.action)) {
        run({ ...request, tone: next });
      }
    },
    status: stream.status,
    suggestion: stream.text,
    setSuggestion: stream.setText,
    errorKey: stream.errorKey,
    meta: stream.meta,
    stop: stream.stop,
    begin,
    ask: (instruction: string) =>
      instruction.trim() &&
      run({ action: "custom", instruction: instruction.trim() }),
    retry: () => request && run(request),
    discard,
    apply,
  };
}

export type CommentAi = ReturnType<typeof useCommentAi>;

/** "✦" in the composer's footer: the AI actions for the draft. */
export function CommentAiButton({
  ai,
  disabled,
}: {
  ai: CommentAi;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="text-muted-foreground"
            disabled={disabled}
          />
        }
        aria-label={t("ai:writing.comment.menuLabel")}
        title={t("ai:writing.comment.menuLabel")}
      >
        <Sparkles className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-56">
        <EditorAiMenuItems
          onRun={ai.begin}
          tone={ai.tone}
          onToneChange={ai.setTone}
        />
      </MenuPopup>
    </Menu>
  );
}

/** The suggestion for the draft, under the composer. */
export function CommentAiPreview({ ai }: { ai: CommentAi }) {
  const { t } = useTranslation();
  const [instruction, setInstruction] = useState("");
  if (!ai.open) return null;

  const title = ai.request
    ? ai.request.action === "custom"
      ? ai.request.instruction
      : t(editorAiActionKey(ai.request.action))
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
      aria-label={t("ai:writing.comment.previewLabel")}
      className="mt-2 rounded-lg border bg-popover p-3 text-popover-foreground"
      onKeyDown={onKeyDown}
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
      {ai.asking ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            ai.ask(instruction);
            setInstruction("");
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
      ) : ai.status === "error" ? (
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
          {ai.status === "streaming" ? (
            <div
              aria-live="polite"
              aria-busy="true"
              className="max-h-48 min-h-10 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 px-2.5 py-2 text-sm"
            >
              {ai.suggestion || (
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
              className="max-h-48"
              value={ai.suggestion}
              onChange={(event) => ai.setSuggestion(event.target.value)}
            />
          )}
          {ai.request &&
            TONED_ACTIONS.has(ai.request.action) &&
            ai.status !== "streaming" && (
              <EditorAiToneSwitch
                className="mt-2"
                value={ai.request.tone ?? ai.tone}
                onChange={ai.changeTone}
              />
            )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {ai.status === "streaming" ? (
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
                  disabled={!ai.suggestion.trim()}
                  onClick={ai.apply}
                >
                  <Replace />
                  {t("ai:writing.comment.replace")}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={ai.retry}
                >
                  {t("ai:writing.preview.retry")}
                </Button>
                {ai.status === "done" && ai.suggestion.trim() && (
                  <AiFeedbackButtons
                    workspaceId={ai.workspaceId}
                    feature="editor_assist"
                    meta={ai.meta}
                    answerKey={ai.meta}
                  />
                )}
              </>
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
