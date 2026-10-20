import {
  ArrowUp,
  Bot,
  Boxes,
  FileText,
  FolderKanban,
  Globe,
  ImageIcon,
  Loader2,
  type LucideIcon,
  Mic,
  Paperclip,
  RefreshCcw,
  Slash,
  Sparkles,
  Square,
  SquareCheck,
  User,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import {
  ATTACHMENT_ACCEPT,
  attachmentProblem,
  readAttachment,
} from "./ask-attachments";
import {
  type AskSkillOption,
  type AskSlashCommand,
  type AskSlashItem,
  SLASH_COMMAND_KEYS,
  slashItems,
} from "./ask-commands";
import {
  mentionQuery,
  removeMentionToken,
  slashQuery,
  useAskMentions,
} from "./use-ask-mentions";
import type {
  AskAttachment,
  AskContextItem,
  AskContextKind,
} from "./use-ask-session";
import { useSpeechInput } from "./use-speech-input";

export type AskMode = "ask" | "build" | "autopilot";

export const CONTEXT_ICONS: Record<AskContextKind, LucideIcon> = {
  task: SquareCheck,
  page: FileText,
  project: FolderKanban,
  cycle: RefreshCcw,
  module: Boxes,
  user: User,
  agent: Bot,
};

const MODE_KEYS: Record<AskMode, string> = {
  ask: "ai:ask.modes.ask",
  build: "ai:ask.modes.build",
  autopilot: "ai:ask.modes.autopilot",
};
const MODE_HINT_KEYS: Record<AskMode, string> = {
  ask: "ai:ask.modes.askHint",
  build: "ai:ask.modes.buildHint",
  autopilot: "ai:ask.modes.autopilotHint",
};
const MAX_CONTEXT = 10;
const MAX_QUESTION_CHARS = 2000;

export type AskComposerPayload = {
  text: string;
  context: AskContextItem[];
  attachments: AskAttachment[];
  webSearch: boolean;
  skill: AskSkillOption | null;
};

/** One chip above the input: context, an attachment or the chosen skill. */
function Chip({
  icon: Icon,
  label,
  removeLabel,
  onRemove,
}: {
  icon: LucideIcon;
  label: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted py-0.5 ps-1.5 pe-0.5 text-xs">
      <Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      <span className="max-w-48 truncate">{label}</span>
      <button
        type="button"
        className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
      >
        <X aria-hidden className="size-3" />
      </button>
    </span>
  );
}

type MenuOption = {
  id: string;
  icon: LucideIcon;
  label: string;
  hint?: string;
};

/** The "@" picker or "/" menu: a listbox the composer steers by keyboard. */
function ComposerMenu({
  id,
  label,
  options,
  active,
  empty,
  onPick,
  onHover,
}: {
  id: string;
  label: string;
  options: readonly MenuOption[];
  active: number;
  empty: string;
  onPick: (index: number) => void;
  onHover: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  return (
    <div className="absolute inset-x-0 bottom-full z-10 mb-1.5 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg/5">
      {options.length === 0 ? (
        <p role="status" className="px-3 py-2 text-muted-foreground text-xs">
          {empty}
        </p>
      ) : (
        <div
          ref={listRef}
          id={id}
          role="listbox"
          aria-label={label}
          className="max-h-60 overflow-y-auto p-1"
        >
          {options.map((option, index) => {
            const Icon = option.icon;
            return (
              <button
                type="button"
                key={option.id}
                id={`${id}-${index}`}
                role="option"
                // Options are steered from the composer (aria-activedescendant).
                tabIndex={-1}
                aria-selected={index === active}
                data-index={index}
                className="flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground"
                // Keep focus in the composer while picking with the mouse.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHover(index)}
                onClick={() => onPick(index)}
              >
                <Icon
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint && (
                  <span className="min-w-0 max-w-[50%] shrink truncate text-muted-foreground text-xs">
                    {option.hint}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Ask's composer: "@" inserts context chips (tasks, pages, projects,
 * cycles, modules, people, agents), "/" opens commands and saved skills,
 * and the toolbar holds the mode (Ask, Build, Autopilot), web search,
 * attachments and voice input. Enter sends; Shift+Enter is a new line.
 */
export function AskComposer({
  workspaceId,
  draft,
  onDraftChange,
  inputRef,
  streaming,
  onStop,
  mode,
  modes,
  onModeChange,
  features,
  skills,
  lang,
  onSend,
  onCommand,
  onSendToAgent,
}: {
  workspaceId: string | undefined;
  draft: string;
  onDraftChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  streaming: boolean;
  onStop: () => void;
  mode: AskMode;
  modes: readonly AskMode[];
  onModeChange: (mode: AskMode) => void;
  features: { webSearch: boolean; speech: boolean; attachments: boolean };
  skills: readonly AskSkillOption[];
  lang: string;
  onSend: (payload: AskComposerPayload) => void;
  onCommand: (command: AskSlashCommand, context: AskContextItem[]) => void;
  onSendToAgent?: (payload: {
    agent: AskContextItem;
    task: AskContextItem | null;
    text: string;
  }) => void;
}) {
  const { t } = useTranslation();
  const menuId = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [context, setContext] = useState<AskContextItem[]>([]);
  const [attachments, setAttachments] = useState<AskAttachment[]>([]);
  const [skill, setSkill] = useState<AskSkillOption | null>(null);
  const [webSearch, setWebSearch] = useState(false);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const ask = mode === "ask";
  const mention = mentionQuery(draft, caret);
  const slash = mention === null ? slashQuery(draft, caret) : null;
  // Escape closes a menu until the text before the caret changes.
  const menuKey = `${mention ?? ""}|${slash ?? ""}|${caret}`;
  const menuOpen =
    (mention !== null || slash !== null) && dismissed !== menuKey;
  const { items: mentionItems, isSearching } = useAskMentions({
    workspaceId,
    query: menuOpen ? mention : null,
  });
  const slashOptions = useMemo(
    () =>
      menuOpen && slash !== null
        ? slashItems(
            slash,
            ask ? skills : [],
            (command) => t(SLASH_COMMAND_KEYS[command].label),
            !ask,
          )
        : [],
    [menuOpen, slash, ask, skills, t],
  );
  const options: MenuOption[] = useMemo(() => {
    if (!menuOpen) return [];
    if (mention !== null) {
      return mentionItems.map((item) => ({
        id: `${item.kind}:${item.id}`,
        icon: CONTEXT_ICONS[item.kind],
        label: item.label,
        hint: t(`ai:ask.contextKinds.${item.kind}`),
      }));
    }
    return slashOptions.map((item) =>
      item.kind === "command"
        ? {
            id: `command:${item.id}`,
            icon: Slash,
            label: `/${item.id} · ${t(SLASH_COMMAND_KEYS[item.id].label)}`,
            hint: t(SLASH_COMMAND_KEYS[item.id].hint),
          }
        : {
            id: `skill:${item.skill.id}`,
            icon: Sparkles,
            label: item.skill.name,
            hint: item.skill.description || t("ai:ask.commands.skill"),
          },
    );
  }, [menuOpen, mention, mentionItems, slashOptions, t]);

  // A new query starts at the top of the list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on query change
  useEffect(() => setActive(0), [mention, slash]);

  const speech = useSpeechInput({
    workspaceId,
    server: features.speech,
    lang,
    onText: (text) => {
      const joined = draft.trim() ? `${draft.trimEnd()} ${text}` : text;
      onDraftChange(joined.slice(0, MAX_QUESTION_CHARS));
      inputRef.current?.focus();
    },
    onError: (error) =>
      toast.error(
        t(error === "denied" ? "ai:ask.voice.denied" : "ai:ask.voice.failed"),
      ),
  });

  const resize = (element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  // Follow outside changes (a prefilled command, a cleared draft).
  // biome-ignore lint/correctness/useExhaustiveDependencies: size follows the text
  useEffect(() => {
    window.requestAnimationFrame?.(() => resize(inputRef.current));
  }, [draft]);

  const setText = (text: string, nextCaret: number) => {
    onDraftChange(text);
    setCaret(nextCaret);
    window.requestAnimationFrame?.(() => {
      const element = inputRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const addContext = (item: AskContextItem) => {
    setContext((current) =>
      current.some((other) => other.kind === item.kind && other.id === item.id)
        ? current
        : [...current, item].slice(0, MAX_CONTEXT),
    );
  };

  const pick = (index: number) => {
    if (mention !== null) {
      const item = mentionItems[index];
      if (!item) return;
      addContext(item);
      const next = removeMentionToken(draft, caret);
      setText(next.text, next.caret);
      return;
    }
    const item: AskSlashItem | undefined = slashOptions[index];
    if (!item) return;
    if (item.kind === "skill") {
      setSkill(item.skill);
      setText("", 0);
      return;
    }
    if (item.id === "chart") {
      const text = `${t("ai:ask.commands.chartPrefill")} `;
      setText(text, text.length);
      return;
    }
    setText("", 0);
    onCommand(item.id, context);
    if (item.id !== "create") setContext([]);
  };

  const reset = () => {
    setContext([]);
    setAttachments([]);
    setSkill(null);
    setCaret(0);
  };

  const send = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    onSend({ text, context, attachments, webSearch, skill });
    reset();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (menuOpen) {
      const count = options.length;
      if (event.key === "ArrowDown" && count > 0) {
        event.preventDefault();
        setActive((index) => (index + 1) % count);
        return;
      }
      if (event.key === "ArrowUp" && count > 0) {
        event.preventDefault();
        setActive((index) => (index - 1 + count) % count);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && count > 0) {
        event.preventDefault();
        pick(active);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(menuKey);
        return;
      }
    }
    if (
      event.key === "Backspace" &&
      draft === "" &&
      (context.length > 0 || skill)
    ) {
      // Backspace in an empty composer removes the last chip.
      if (skill) setSkill(null);
      else setContext((current) => current.slice(0, -1));
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    let count = attachments.length;
    let bytes = attachments.reduce((sum, file) => sum + file.size, 0);
    const accepted: File[] = [];
    for (const file of files) {
      const problem = attachmentProblem(file, { count, bytes });
      if (problem) {
        toast.error(t(`ai:ask.attachments.${problem}`, { name: file.name }));
        continue;
      }
      accepted.push(file);
      count += 1;
      bytes += file.size;
    }
    try {
      const read = await Promise.all(accepted.map(readAttachment));
      setAttachments((current) => [...current, ...read].slice(0, 3));
    } catch {
      toast.error(t("ai:ask.attachments.readError"));
    }
  };

  const agent = context.find((item) => item.kind === "agent") ?? null;
  const task = context.find((item) => item.kind === "task") ?? null;
  const placeholder = ask
    ? t("ai:ask.placeholder")
    : t("ai:ask.placeholderBuild");
  const recording = speech.state === "recording";
  const hasChips = context.length > 0 || attachments.length > 0 || skill;

  return (
    <div className="relative">
      {menuOpen && (
        <ComposerMenu
          id={menuId}
          label={
            mention !== null
              ? t("ai:ask.contextPicker")
              : t("ai:ask.commandMenu")
          }
          options={options}
          active={active}
          empty={
            mention !== null
              ? isSearching
                ? t("ai:ask.contextSearching")
                : mention
                  ? t("ai:ask.contextEmpty")
                  : t("ai:ask.contextHint")
              : t("ai:ask.commandEmpty")
          }
          onPick={pick}
          onHover={setActive}
        />
      )}
      <div
        className={cn(
          "flex flex-col gap-1 rounded-2xl border border-input bg-background px-1.5 pt-1.5 pb-1.5 ring-ring/24 transition-shadow focus-within:border-ring focus-within:ring-[3px] dark:bg-input/32",
          streaming && "ask-composer-busy",
        )}
      >
        {hasChips && (
          <ul
            className="flex flex-wrap gap-1 px-1.5 pt-0.5"
            aria-label={t("ai:ask.contextChips")}
          >
            {skill && (
              <li>
                <Chip
                  icon={Sparkles}
                  label={skill.name}
                  removeLabel={t("ai:ask.removeChip", { name: skill.name })}
                  onRemove={() => setSkill(null)}
                />
              </li>
            )}
            {context.map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                <Chip
                  icon={CONTEXT_ICONS[item.kind]}
                  label={item.label}
                  removeLabel={t("ai:ask.removeChip", { name: item.label })}
                  onRemove={() =>
                    setContext((current) =>
                      current.filter((other) => other !== item),
                    )
                  }
                />
              </li>
            ))}
            {attachments.map((file, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: two files may share a name
              <li key={`${file.name}-${index}`}>
                <Chip
                  icon={
                    file.mediaType.startsWith("image/") ? ImageIcon : Paperclip
                  }
                  label={file.name}
                  removeLabel={t("ai:ask.removeChip", { name: file.name })}
                  onRemove={() =>
                    setAttachments((current) =>
                      current.filter((_other, at) => at !== index),
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {ask && agent && onSendToAgent && (
          <div className="mx-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 px-2 py-1.5 text-xs">
            <Bot aria-hidden className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-muted-foreground">
              {task
                ? t("ai:ask.agent.ready", { agent: agent.label })
                : t("ai:ask.agent.needsTask", { agent: agent.label })}
            </span>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!task || !draft.trim() || streaming}
              onClick={() => {
                onSendToAgent({ agent, task, text: draft.trim() });
                onDraftChange("");
                reset();
              }}
            >
              {t("ai:ask.agent.send", { agent: agent.label })}
            </Button>
          </div>
        )}
        <Textarea
          unstyled
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(event) => {
            onDraftChange(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            resize(event.target);
          }}
          onSelect={(event) =>
            setCaret(event.currentTarget.selectionStart ?? 0)
          }
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={t("ai:ask.placeholder")}
          aria-controls={menuOpen && options.length > 0 ? menuId : undefined}
          aria-activedescendant={
            menuOpen && options.length > 0 ? `${menuId}-${active}` : undefined
          }
          aria-autocomplete="list"
          maxLength={MAX_QUESTION_CHARS}
          className="flex min-w-0 [&_textarea]:max-h-40 [&_textarea]:min-h-8 [&_textarea]:resize-none [&_textarea]:overflow-y-auto [&_textarea]:bg-transparent [&_textarea]:px-2 [&_textarea]:py-1.5 [&_textarea]:text-sm [&_textarea]:placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-0.5">
          {modes.length > 1 && (
            <fieldset
              aria-label={t("ai:ask.modes.label")}
              className="me-1 inline-flex items-center rounded-full border p-0.5"
            >
              {modes.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={mode === item}
                  title={t(MODE_HINT_KEYS[item])}
                  onClick={() => onModeChange(item)}
                  className="rounded-full px-2 py-0.5 text-muted-foreground text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:font-medium aria-pressed:text-foreground"
                >
                  {t(MODE_KEYS[item])}
                </button>
              ))}
            </fieldset>
          )}
          {ask && features.webSearch && (
            <ToolButton
              label={t("ai:ask.webSearch")}
              pressed={webSearch}
              onClick={() => setWebSearch((value) => !value)}
            >
              <Globe aria-hidden />
            </ToolButton>
          )}
          {ask && features.attachments && (
            <>
              <ToolButton
                label={t("ai:ask.attachments.add")}
                disabled={attachments.length >= 3}
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip aria-hidden />
              </ToolButton>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                accept={ATTACHMENT_ACCEPT}
                aria-hidden
                tabIndex={-1}
                onChange={(event) => void onFiles(event)}
              />
            </>
          )}
          {speech.supported && (
            <ToolButton
              label={
                recording ? t("ai:ask.voice.stop") : t("ai:ask.voice.start")
              }
              pressed={recording}
              disabled={speech.state === "transcribing"}
              onClick={speech.toggle}
              className={cn(
                recording &&
                  "text-destructive-foreground motion-safe:animate-pulse",
              )}
            >
              {speech.state === "transcribing" ? (
                <Loader2 aria-hidden className="motion-safe:animate-spin" />
              ) : (
                <Mic aria-hidden />
              )}
            </ToolButton>
          )}
          <span className="sr-only" role="status">
            {recording
              ? t("ai:ask.voice.recording")
              : speech.state === "transcribing"
                ? t("ai:ask.voice.transcribing")
                : ""}
          </span>
          <div className="ms-auto">
            {streaming ? (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="rounded-full before:rounded-full"
                aria-label={t("ai:ask.stop")}
                title={t("ai:ask.stop")}
                onClick={onStop}
              >
                <Square aria-hidden className="size-3 fill-current" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon-sm"
                className="rounded-full before:rounded-full"
                aria-label={t("ai:ask.send")}
                title={t("ai:ask.send")}
                disabled={!draft.trim()}
                onClick={send}
              >
                <ArrowUp aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  children,
  pressed,
  disabled,
  className,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground",
        className,
      )}
    >
      {children}
    </Button>
  );
}
