import type { Editor, EditorEvents } from "@tiptap/core";
import type { TFunction } from "i18next";
import {
  Check,
  FileQuestion,
  ListChecks,
  MessageSquareText,
  RotateCw,
  Sparkles,
  TextQuote,
  X,
} from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import AiMarkdown from "@/components/ai/ai-markdown";
import type { SlashCommand } from "@/components/editor/use-slash-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { type PageBlockPreset, streamPageBlock } from "@/fetchers/ai/writing";
import { useAiTextStream } from "@/hooks/use-ai-text-stream";
import AiFeedbackButtons from "./ai-feedback-buttons";
import { insertBlockAt } from "./editor-ai-apply";
import { useAiLocale } from "./use-editor-ai";

// The page editor's "/AI block": generate a TL;DR, an FAQ, action items or
// anything asked from the page itself. The answer is a proposal shown in
// place; nothing reaches the document (or co-editors) until Accept, which
// inserts it as ordinary content in one undoable transaction.

/** The API's cap on the page text sent along. */
const MAX_PAGE_CHARS = 60_000;

export const AI_BLOCK_PRESETS = [
  "tldr",
  "faq",
  "action_items",
  "custom",
] as const satisfies readonly PageBlockPreset[];

const PRESET_ICONS = {
  tldr: TextQuote,
  faq: FileQuestion,
  action_items: ListChecks,
  custom: MessageSquareText,
} as const;

export function aiBlockPresetKey(preset: PageBlockPreset): string {
  return `ai:writing.block.presets.${preset}`;
}

export type AiBlockSession = {
  /** Where the block goes, kept in step with edits. */
  pos: number;
  preset: PageBlockPreset | null;
  instruction: string;
  /** The page changed after the proposal was generated. */
  stale: boolean;
};

/** "/AI block" in the slash menu (Insert group). */
export function aiBlockSlashCommand(
  t: TFunction,
  open: (editor: Editor, pos: number) => void,
): SlashCommand {
  return {
    id: "ai-block",
    label: t("ai:writing.block.command"),
    group: "insert",
    icon: Sparkles,
    search: "ai block generate summary tldr faq action items todo assistant",
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      open(editor, editor.state.selection.from);
    },
  };
}

export function useAiBlock({
  editor,
  workspaceId,
  pageId,
}: {
  editor: Editor | null;
  workspaceId: string;
  pageId: string;
}) {
  const locale = useAiLocale();
  const stream = useAiTextStream();
  const [session, setSession] = useState<AiBlockSession | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // Our own insert on Accept is not someone else's change.
  const applyingRef = useRef(false);
  const active = session !== null;

  useEffect(() => {
    if (!editor || !active) return;
    const onTransaction = ({ transaction }: EditorEvents["transaction"]) => {
      if (!transaction.docChanged || applyingRef.current) return;
      setSession((current) =>
        current
          ? {
              ...current,
              pos: transaction.mapping.map(current.pos),
              stale: current.stale || current.preset !== null,
            }
          : current,
      );
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor, active]);

  const open = useCallback(
    (_editor: Editor, pos: number) => {
      stream.reset();
      setSession({ pos, preset: null, instruction: "", stale: false });
    },
    [stream.reset],
  );

  const generate = useCallback(
    (preset: PageBlockPreset, instruction = "") => {
      if (!editor || editor.isDestroyed) return;
      const current = sessionRef.current;
      if (!current) return;
      if (preset === "custom" && !instruction.trim()) {
        setSession({ ...current, preset: null, instruction: "" });
        return;
      }
      setSession({ ...current, preset, instruction, stale: false });
      const text = editor.getMarkdown().trim().slice(0, MAX_PAGE_CHARS);
      void stream.start((handlers) =>
        streamPageBlock(
          {
            workspaceId,
            pageId,
            preset,
            ...(preset === "custom" ? { instruction: instruction.trim() } : {}),
            ...(text ? { text } : {}),
            ...(locale ? { locale } : {}),
          },
          handlers,
        ),
      );
    },
    [editor, locale, pageId, stream.start, workspaceId],
  );

  const regenerate = useCallback(() => {
    const current = sessionRef.current;
    if (current?.preset) generate(current.preset, current.instruction);
  }, [generate]);

  const discard = useCallback(() => {
    stream.reset();
    setSession(null);
    editor?.commands.focus();
  }, [editor, stream.reset]);

  const accept = useCallback(() => {
    const current = sessionRef.current;
    if (!editor || !current || !stream.text.trim()) return false;
    applyingRef.current = true;
    const before = editor.state.doc;
    let applied = false;
    try {
      applied = insertBlockAt(editor, current.pos, stream.text);
    } catch {
      // Scrolling or focusing can fail after the insert itself landed.
      applied = editor.state.doc !== before;
    } finally {
      applyingRef.current = false;
    }
    if (applied) {
      stream.reset();
      setSession(null);
    }
    return applied;
  }, [editor, stream.reset, stream.text]);

  return {
    workspaceId,
    session,
    status: stream.status,
    text: stream.text,
    errorKey: stream.errorKey,
    meta: stream.meta,
    stop: stream.stop,
    open,
    generate,
    regenerate,
    discard,
    accept,
  };
}

export type AiBlock = ReturnType<typeof useAiBlock>;

/**
 * The AI block in place: presets first, then the streamed proposal with
 * Accept, Regenerate and Discard. Escape discards.
 */
export function AiBlockPanel({
  editor,
  block,
  shellRef,
}: {
  editor: Editor;
  block: AiBlock;
  shellRef: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const { session, status, text } = block;
  const [top, setTop] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [asking, setAsking] = useState(false);
  const pos = session?.pos ?? null;

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (pos === null || !shell || editor.isDestroyed) return;
    try {
      const at = Math.min(pos, editor.state.doc.content.size);
      const coords = editor.view.coordsAtPos(at);
      setTop(coords.bottom - shell.getBoundingClientRect().top + 8);
    } catch {
      setTop(null);
    }
  }, [editor, pos, shellRef]);

  useEffect(() => {
    if (session?.preset === null) return;
    setAsking(false);
  }, [session?.preset]);

  if (!session) return null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      block.discard();
    }
  };

  const title = session.preset
    ? t(aiBlockPresetKey(session.preset))
    : t("ai:writing.block.title");

  return (
    <section
      aria-label={t("ai:writing.block.title")}
      className="absolute inset-x-0 z-30 mx-auto max-w-2xl rounded-lg border border-dashed border-primary/50 bg-popover p-3 text-popover-foreground shadow-lg/5"
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
          onClick={block.discard}
        >
          <X />
        </Button>
      </div>

      {session.preset === null ? (
        asking ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              block.generate("custom", custom);
            }}
          >
            <Input
              size="sm"
              autoFocus
              value={custom}
              maxLength={500}
              onChange={(event) => setCustom(event.target.value)}
              placeholder={t("ai:writing.block.customPlaceholder")}
              aria-label={t("ai:writing.block.presets.custom")}
            />
            <Button type="submit" size="xs" disabled={!custom.trim()}>
              {t("ai:writing.customSubmit")}
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            {AI_BLOCK_PRESETS.map((preset) => {
              const Icon = PRESET_ICONS[preset];
              return (
                <Button
                  key={preset}
                  type="button"
                  size="xs"
                  variant="outline"
                  autoFocus={preset === "tldr"}
                  onClick={() =>
                    preset === "custom"
                      ? setAsking(true)
                      : block.generate(preset)
                  }
                >
                  <Icon />
                  {t(aiBlockPresetKey(preset))}
                </Button>
              );
            })}
          </div>
        )
      ) : status === "error" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p
            role="alert"
            className="flex-1 text-destructive-foreground text-sm"
          >
            {t(block.errorKey ?? "ai:errors.unknown")}
          </p>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={block.regenerate}
          >
            {t("ai:writing.preview.retry")}
          </Button>
        </div>
      ) : (
        <>
          <div
            aria-live="polite"
            aria-busy={status === "streaming"}
            className="max-h-72 min-h-10 overflow-y-auto rounded-md bg-muted/40 px-2.5 py-2"
          >
            {text ? (
              <AiMarkdown text={text} />
            ) : status === "streaming" ? (
              <span className="inline-flex items-center gap-2 text-muted-foreground text-sm">
                <Spinner className="size-3.5" />
                {t("ai:writing.preview.generating")}
              </span>
            ) : (
              <p className="text-muted-foreground text-sm">
                {t("ai:writing.preview.empty")}
              </p>
            )}
          </div>
          {session.stale && status !== "streaming" && (
            <p role="status" className="mt-2 text-muted-foreground text-xs">
              {t("ai:writing.block.stale")}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {status === "streaming" ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={block.stop}
              >
                {t("ai:writing.preview.stop")}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  size="xs"
                  disabled={!text.trim()}
                  onClick={() => block.accept()}
                >
                  <Check />
                  {t("ai:writing.block.accept")}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={block.regenerate}
                >
                  <RotateCw />
                  {t("ai:writing.block.regenerate")}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={block.discard}
                >
                  {t("ai:writing.preview.discard")}
                </Button>
                {status === "done" && text.trim() && (
                  <AiFeedbackButtons
                    workspaceId={block.workspaceId}
                    feature="editor_assist"
                    meta={block.meta}
                    answerKey={block.meta}
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
