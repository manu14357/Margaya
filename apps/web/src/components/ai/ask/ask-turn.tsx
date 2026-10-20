import {
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FilePlus2,
  FileText,
  Globe,
  MoreHorizontal,
  Paperclip,
  Pencil,
  RotateCw,
  Sparkles,
  SquarePlus,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { Textarea } from "@/components/ui/textarea";
import type { AskSource } from "@/fetchers/ai/ask";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import { AskAnswer, SourceLink } from "./ask-answer";
import { answerAsMarkdown, answerForCopy, citedSources } from "./ask-citations";
import { CONTEXT_ICONS } from "./ask-composer";
import type { AskRating, AskTurn } from "./use-ask-session";

const MAX_LISTED_MATCHES = 8;
const DOTS = ["0ms", "150ms", "300ms"] as const;

export function sourceMap(sources: readonly AskSource[]) {
  return new Map(sources.map((source) => [source.ref, source]));
}

/** The small round mark beside Ask's own messages. */
export function AskAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted text-foreground",
        className,
      )}
    >
      <Sparkles className="size-3.5" />
    </span>
  );
}

/** Three bouncing dots while the first words of an answer are on their way. */
function TypingIndicator({ label }: { label: string }) {
  return (
    <span
      role="status"
      className="inline-flex h-7 items-center gap-1"
      data-testid="ask-typing"
    >
      <span className="sr-only">{label}</span>
      {DOTS.map((delay) => (
        <span
          key={delay}
          aria-hidden
          className="size-1.5 rounded-full bg-muted-foreground/70 motion-safe:animate-bounce"
          style={{ animationDelay: delay }}
        />
      ))}
    </span>
  );
}

function seconds(ms: number) {
  return Math.max(1, Math.round(ms / 1000));
}

/** Whole seconds since `since`, ticking while mounted. */
function useElapsed(since: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, now - since);
}

/**
 * "Thinking… 12s" while the model reasons, then "Thought for 20s". The
 * reasoning text, when the instance shows it, opens below.
 */
export function AskThinking({
  thinkingSince,
  reasoning,
  reasoningMs,
}: {
  thinkingSince: number | null;
  reasoning: string;
  reasoningMs: number | null;
}) {
  const { t } = useTranslation();
  const elapsed = useElapsed(thinkingSince);
  const live = thinkingSince !== null;
  // Open while the model thinks, folded once the answer starts; a click
  // overrides either way.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? live;
  const textRef = useRef<HTMLParagraphElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new text
  useEffect(() => {
    const node = textRef.current;
    if (live && node) node.scrollTop = node.scrollHeight;
  }, [reasoning, live]);
  if (!live && (reasoningMs === null || reasoningMs <= 0)) return null;
  const label = live
    ? t("ai:ask.thinking.live", { seconds: Math.floor(elapsed / 1000) })
    : t("ai:ask.thinking.done", { seconds: seconds(reasoningMs ?? 0) });
  const icon = <Brain aria-hidden className="size-3.5 shrink-0" />;
  const labelNode = (
    <span
      role={live ? "status" : undefined}
      className={cn(live && "ask-shimmer")}
    >
      {label}
    </span>
  );
  if (!reasoning.trim()) {
    return (
      <p
        className="inline-flex items-center gap-1.5 text-muted-foreground text-xs"
        data-testid="ask-thinking"
      >
        {icon}
        {labelNode}
      </p>
    );
  }
  return (
    <div className="text-xs" data-testid="ask-thinking">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
        className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {icon}
        {labelNode}
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <p
          ref={textRef}
          className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap border-s-2 ps-2.5 text-muted-foreground leading-relaxed"
        >
          {reasoning}
        </p>
      )}
    </div>
  );
}

/** The question bubble, editable in place (Enter resends, Escape cancels). */
function QuestionBubble({
  turn,
  editable,
  onEdit,
}: {
  turn: AskTurn;
  editable: boolean;
  onEdit: (question: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(turn.question);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!editing) return;
    const element = inputRef.current;
    element?.focus();
    element?.setSelectionRange(element.value.length, element.value.length);
  }, [editing]);

  const save = () => {
    const text = value.trim();
    setEditing(false);
    if (text && text !== turn.question) onEdit(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <Textarea
          ref={inputRef}
          value={value}
          rows={2}
          maxLength={2000}
          aria-label={t("ai:ask.editQuestion")}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          className="w-[85%] [&_textarea]:min-h-14 [&_textarea]:text-sm"
        />
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={!value.trim()}
            onClick={save}
          >
            {t("ai:ask.resend")}
          </Button>
        </div>
      </div>
    );
  }

  const chips = turn.context.length > 0 || turn.attachmentNames.length > 0;
  return (
    <div className="group/question flex flex-col items-end gap-1">
      {(chips || turn.skillName || turn.webSearch) && (
        <ul className="flex max-w-[85%] flex-wrap justify-end gap-1">
          {turn.skillName && (
            <li className="inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-muted-foreground text-xs">
              <Sparkles aria-hidden className="size-3" />
              {turn.skillName}
            </li>
          )}
          {turn.webSearch && (
            <li className="inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-muted-foreground text-xs">
              <Globe aria-hidden className="size-3" />
              {t("ai:ask.webSearch")}
            </li>
          )}
          {turn.context.map((item) => {
            const Icon = CONTEXT_ICONS[item.kind];
            return (
              <li
                key={`${item.kind}:${item.id}`}
                className="inline-flex max-w-48 items-center gap-1 rounded-md border px-1.5 py-px text-muted-foreground text-xs"
              >
                <Icon aria-hidden className="size-3 shrink-0" />
                <span className="truncate">{item.label}</span>
              </li>
            );
          })}
          {turn.attachmentNames.map((name, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: names may repeat
              key={`${name}-${index}`}
              className="inline-flex max-w-48 items-center gap-1 rounded-md border px-1.5 py-px text-muted-foreground text-xs"
            >
              <Paperclip aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{name}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex max-w-full items-start justify-end gap-1">
        {editable && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="mt-1 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/question:opacity-100 pointer-coarse:opacity-100"
            aria-label={t("ai:ask.editQuestion")}
            title={t("ai:ask.editQuestion")}
            onClick={() => {
              setValue(turn.question);
              setEditing(true);
            }}
          >
            <Pencil aria-hidden />
          </Button>
        )}
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-muted px-3.5 py-2 text-sm">
          <span className="sr-only">{t("ai:ask.you")}: </span>
          {turn.question}
        </p>
      </div>
    </div>
  );
}

/** 👎 asks why (optional) before the rating is sent. */
function FeedbackReason({
  onSend,
}: {
  onSend: (reason: string | null) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const labelId = useId();
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <form
      className="flex w-full flex-col gap-1.5 rounded-lg border px-2.5 py-2"
      aria-labelledby={labelId}
      onSubmit={(event) => {
        event.preventDefault();
        onSend(reason.trim() || null);
      }}
    >
      <p id={labelId} className="text-muted-foreground text-xs">
        {t("ai:ask.feedback.reasonLabel")}
      </p>
      <div className="flex gap-1.5">
        <Input
          ref={inputRef}
          size="sm"
          value={reason}
          maxLength={300}
          placeholder={t("ai:ask.feedback.reasonPlaceholder")}
          aria-labelledby={labelId}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onSend(null);
            }
          }}
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => onSend(null)}
        >
          {t("ai:ask.feedback.skip")}
        </Button>
        <Button type="submit" size="xs">
          {t("ai:ask.feedback.send")}
        </Button>
      </div>
    </form>
  );
}

export type AskTurnActions = {
  onRegenerate?: () => void;
  onEdit?: (question: string) => void;
  onVersion?: (index: number) => void;
  onRate?: (rating: AskRating, reason: string | null) => void;
  onFollowUp?: (question: string) => void;
  onSaveAsPage?: (markdown: string) => void;
  onCreateTask?: (markdown: string) => void;
};

/** One exchange: the question as a bubble, the cited answer beside Ask's mark. */
export function AskTurnView({
  turn,
  allSources,
  onOpen,
  isLast = false,
  busy = false,
  actions = {},
}: {
  turn: AskTurn;
  allSources: ReadonlyMap<string, AskSource>;
  onOpen: (url: string) => void;
  /** The newest turn: it can be regenerated and shows follow-ups. */
  isLast?: boolean;
  /** Another answer is streaming. */
  busy?: boolean;
  actions?: AskTurnActions;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [askingReason, setAskingReason] = useState(false);
  const streaming = turn.status === "streaming";
  const own = useMemo(() => sourceMap(turn.sources), [turn.sources]);
  const cited = useMemo(() => {
    const confirmed = turn.citations.flatMap((ref) => own.get(ref) ?? []);
    return confirmed.length > 0 ? confirmed : citedSources(turn.answer, own);
  }, [turn.citations, turn.answer, own]);
  const others = turn.sources
    .filter((source) => !cited.includes(source))
    .slice(0, MAX_LISTED_MATCHES);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const writeClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      toast.error(t("ai:ask.copyError"));
      return false;
    }
  };

  const copy = async () => {
    if (
      await writeClipboard(
        answerForCopy(
          turn.answer,
          own,
          window.location.origin,
          t("ai:ask.sources"),
        ),
      )
    ) {
      setCopied(true);
    }
  };

  const markdown = () =>
    answerAsMarkdown(turn.answer, allSources, window.location.origin);

  const copyMarkdown = async () => {
    if (await writeClipboard(markdown())) {
      toast.success(t("ai:ask.copiedMarkdown"));
    }
  };

  const rate = (rating: AskRating) => {
    if (rating === -1) {
      setAskingReason(true);
      return;
    }
    actions.onRate?.(1, null);
  };

  const settled = !streaming && turn.answer.trim().length > 0;
  const showThinking =
    turn.thinkingSince !== null ||
    (turn.reasoningMs !== null && turn.reasoningMs > 0);
  const waiting =
    streaming && !turn.answer && turn.thinkingSince === null && !turn.noResults;

  return (
    <>
      <QuestionBubble
        turn={turn}
        editable={Boolean(actions.onEdit) && !turn.command && !busy}
        onEdit={(question) => actions.onEdit?.(question)}
      />
      <div className="flex gap-2.5">
        <AskAvatar />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
          <section
            aria-live="polite"
            aria-busy={streaming}
            aria-label={t("ai:ask.answer")}
            className="flex min-w-0 flex-col gap-2"
          >
            {showThinking && (
              <AskThinking
                thinkingSince={turn.thinkingSince}
                reasoning={turn.reasoning}
                reasoningMs={turn.reasoningMs}
              />
            )}
            {waiting && <TypingIndicator label={t("ai:ask.searching")} />}
            {turn.noResults && (
              <p className="text-muted-foreground text-sm">
                {t("ai:ask.noResults")}
              </p>
            )}
            {turn.answer && (
              <AskAnswer
                text={turn.answer}
                sources={allSources}
                onOpen={onOpen}
              />
            )}
            {turn.status === "stopped" && (
              <p className="text-muted-foreground text-xs">
                {t("ai:ask.stopped")}
              </p>
            )}
            {turn.status === "error" && turn.errorKey && (
              <p role="alert" className="text-destructive-foreground text-sm">
                {t(turn.errorKey)}
              </p>
            )}
          </section>
          {!streaming && (
            <div className="flex flex-col items-start gap-1.5">
              <div className="-ms-2 flex flex-wrap items-center gap-0.5">
                {turn.versionCount > 1 && (
                  <span className="me-1 inline-flex items-center text-muted-foreground text-xs">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("ai:ask.versions.previous")}
                      title={t("ai:ask.versions.previous")}
                      disabled={turn.versionIndex === 0 || busy}
                      onClick={() => actions.onVersion?.(turn.versionIndex - 1)}
                    >
                      <ChevronLeft aria-hidden className="rtl:rotate-180" />
                    </Button>
                    <span className="min-w-7 text-center tabular-nums">
                      <span aria-hidden>
                        {turn.versionIndex + 1}/{turn.versionCount}
                      </span>
                      <span className="sr-only">
                        {t("ai:ask.versions.label", {
                          current: turn.versionIndex + 1,
                          total: turn.versionCount,
                        })}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("ai:ask.versions.next")}
                      title={t("ai:ask.versions.next")}
                      disabled={
                        turn.versionIndex >= turn.versionCount - 1 || busy
                      }
                      onClick={() => actions.onVersion?.(turn.versionIndex + 1)}
                    >
                      <ChevronRight aria-hidden className="rtl:rotate-180" />
                    </Button>
                  </span>
                )}
                {turn.answer && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    onClick={() => void copy()}
                  >
                    {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                    {copied ? t("ai:ask.copied") : t("ai:ask.copy")}
                  </Button>
                )}
                {settled && actions.onRate && (
                  <>
                    <IconAction
                      label={t("ai:ask.feedback.up")}
                      pressed={turn.rating === 1}
                      disabled={turn.rating !== null}
                      onClick={() => rate(1)}
                    >
                      <ThumbsUp aria-hidden />
                    </IconAction>
                    <IconAction
                      label={t("ai:ask.feedback.down")}
                      pressed={turn.rating === -1 || askingReason}
                      disabled={turn.rating !== null || askingReason}
                      onClick={() => rate(-1)}
                    >
                      <ThumbsDown aria-hidden />
                    </IconAction>
                  </>
                )}
                {isLast && actions.onRegenerate && !busy && (
                  <IconAction
                    label={t("ai:ask.regenerate")}
                    onClick={actions.onRegenerate}
                  >
                    <RotateCw aria-hidden />
                  </IconAction>
                )}
                {settled && (
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={t("ai:ask.moreActions")}
                          title={t("ai:ask.moreActions")}
                        />
                      }
                    >
                      <MoreHorizontal aria-hidden />
                    </MenuTrigger>
                    <MenuPopup align="start">
                      {actions.onSaveAsPage && (
                        <MenuItem
                          onClick={() => actions.onSaveAsPage?.(markdown())}
                        >
                          <FilePlus2 aria-hidden />
                          {t("ai:ask.saveAsPage")}
                        </MenuItem>
                      )}
                      <MenuItem onClick={() => void copyMarkdown()}>
                        <FileText aria-hidden />
                        {t("ai:ask.copyMarkdown")}
                      </MenuItem>
                      {actions.onCreateTask && (
                        <MenuItem
                          onClick={() => actions.onCreateTask?.(markdown())}
                        >
                          <SquarePlus aria-hidden />
                          {t("ai:ask.createTask")}
                        </MenuItem>
                      )}
                    </MenuPopup>
                  </Menu>
                )}
              </div>
              {askingReason && (
                <FeedbackReason
                  onSend={(reason) => {
                    setAskingReason(false);
                    actions.onRate?.(-1, reason);
                  }}
                />
              )}
              {turn.rating !== null && !askingReason && (
                <p role="status" className="text-muted-foreground text-xs">
                  {t("ai:ask.feedback.thanks")}
                </p>
              )}
              {turn.sources.length > 0 && (
                <details className="group w-full rounded-lg border px-2.5 py-1.5 text-sm">
                  <summary className="cursor-pointer select-none text-muted-foreground text-xs">
                    {t("ai:ask.sourcesCount", {
                      total: cited.length > 0 ? cited.length : others.length,
                    })}
                  </summary>
                  {cited.length > 0 && (
                    <SourceList sources={cited} onOpen={onOpen} />
                  )}
                  {others.length > 0 && (
                    <>
                      <p className="mt-2 text-muted-foreground text-xs">
                        {t("ai:ask.closestMatches")}
                      </p>
                      <SourceList sources={others} onOpen={onOpen} muted />
                    </>
                  )}
                </details>
              )}
              {isLast &&
                turn.status === "done" &&
                turn.followUps.length > 0 &&
                actions.onFollowUp && (
                  <ul
                    className="flex flex-wrap gap-1.5 pt-0.5"
                    aria-label={t("ai:ask.followUps")}
                  >
                    {turn.followUps.map((question) => (
                      <li key={question}>
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-full border bg-background px-3 py-1 text-start text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-64 dark:bg-input/32 dark:hover:bg-input/64"
                          onClick={() => actions.onFollowUp?.(question)}
                        >
                          {question}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function IconAction({
  label,
  onClick,
  children,
  pressed,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:opacity-100"
    >
      {children}
    </Button>
  );
}

function SourceList({
  sources,
  onOpen,
  muted = false,
}: {
  sources: readonly AskSource[];
  onOpen: (url: string) => void;
  muted?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {sources.map((source) => (
        <li key={source.ref} className="min-w-0">
          <SourceLink
            source={source}
            onOpen={onOpen}
            className={
              muted
                ? "block truncate rounded-sm py-0.5 text-muted-foreground hover:text-foreground hover:underline"
                : "block truncate rounded-sm py-0.5 hover:underline"
            }
          >
            {source.kind === "comment"
              ? t("ai:ask.commentOn", { key: source.title })
              : source.kind === "page"
                ? t("ai:ask.pageSource", { title: source.title })
                : source.kind === "web"
                  ? t("ai:ask.webSource", { title: source.title })
                  : source.title}
          </SourceLink>
        </li>
      ))}
    </ul>
  );
}
