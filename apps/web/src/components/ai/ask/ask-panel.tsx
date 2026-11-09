import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  Check,
  Download,
  ExternalLink,
  FilePlus2,
  FolderKanban,
  History,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useAiLocale } from "@/components/editor/ai/use-editor-ai";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import CreateTaskModal from "@/components/shared/modals/lazy-create-task-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { streamBrief } from "@/fetchers/ai/brief";
import { streamSummary } from "@/fetchers/ai/writing";
import { useStartAgentRun } from "@/hooks/mutations/ai/use-agent-mutations";
import { useSendAiFeedback } from "@/hooks/mutations/ai/use-ai-assistant-mutations";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useAiSkills } from "@/hooks/queries/ai/use-ai-assistant";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { aiErrorKey } from "@/lib/ai/format";
import { AI_DESTINATION_KEYS } from "@/lib/ai/labels";
import { cn } from "@/lib/cn";
import { onSignOut } from "@/lib/sign-out";
import { toast } from "@/lib/toast";
import {
  AskAgentRun,
  AskBuildTurnView,
  BUILD_MODE_AVAILABLE,
  historyOf,
  useAskBuild,
} from "./ask-build";
import { answerAsMarkdown } from "./ask-citations";
import type { AskSlashCommand } from "./ask-commands";
import {
  AskComposer,
  type AskComposerPayload,
  type AskMode,
} from "./ask-composer";
import {
  type AskConversation,
  clearAllAskHistory,
  conversationMarkdown,
  MAX_TITLE_CHARS,
  newConversationId,
  toStoredTurns,
} from "./ask-history";
import { AskHistoryList } from "./ask-history-list";
import "./ask-panel.css";
import { AskSaveDialog } from "./ask-save-dialog";
import { useAskPanel } from "./ask-store";
import { AskAvatar, AskTurnView, sourceMap } from "./ask-turn";
import type { AskConversationSummary } from "./use-ask-history";
import { useAskHistory } from "./use-ask-history";
import {
  type AskContextItem,
  type AskStreamer,
  useAskSession,
} from "./use-ask-session";
import { useVoiceMode } from "./use-voice-mode";

// Suggestions on an empty conversation; a project gets project questions.
const WORKSPACE_SUGGESTIONS = [
  "ai:ask.examples.overdue",
  "ai:ask.examples.mine",
  "ai:ask.examples.recent",
  "ai:ask.examples.chart",
] as const;
const PROJECT_SUGGESTIONS = [
  "ai:ask.examples.summarize",
  "ai:ask.examples.overdue",
  "ai:ask.examples.cycleBlockers",
  "ai:ask.examples.chart",
] as const;

type Extra =
  | { key: string; after: number; kind: "build"; index: number }
  | { key: string; after: number; kind: "agent"; runId: string };

type SaveRequest = { title: string; content: string };

// Below Tailwind's `sm` the chat window covers the page.
function coversPage() {
  try {
    return window.matchMedia?.("(max-width: 639px)").matches ?? false;
  } catch {
    return false;
  }
}

function routeId(pathname: string, segment: string): string | null {
  return new RegExp(`/${segment}/([^/]+)`).exec(pathname)?.[1] ?? null;
}

function languageName(locale: string): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale
    );
  } catch {
    return locale;
  }
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function fileName(title: string) {
  const base = title
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "conversation"}.md`;
}

/**
 * Ask: questions about the workspace in plain language, answered with
 * citations, in a chat window docked bottom-right. It is not modal: the page
 * stays visible and usable behind it. Mounted once (routes/_layout.tsx), so
 * the conversation survives navigation and closing; while the full-page AI
 * route is open the same panel renders there. Conversations are saved in
 * this browser, or on the server when the workspace keeps chat history.
 */
export default function AskPanel() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const href = useLocation({ select: (location) => location.href });
  const { open, setOpen, projectId, setProjectId, request, slot } =
    useAskPanel();
  const { user } = useAuth();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const availability = useAiAvailability();
  const { available } = availability;
  const features = availability.data?.features;
  const fullPage = slot !== null;
  const visible = (open || fullPage) && available;
  const locale = useAiLocale();
  const session = useAskSession({ workspaceId, projectId, locale });
  const { ask, clear, load } = session;
  const history = useAskHistory({
    userId: user?.id,
    workspaceId,
    server: features?.storeConversations === true,
  });
  const { clearAll } = history;
  const build = useAskBuild({ workspaceId, projectId });
  const { data: projects } = useGetProjects({
    workspaceId: visible ? (workspaceId ?? "") : "",
  });
  const skillsQuery = useAiSkills(workspaceId, visible);
  const sendFeedback = useSendAiFeedback();
  const startRun = useStartAgentRun();
  const { canCreatePages, canCreateTasks } = useWorkspacePermission();
  const project = projects?.find((item) => item.id === projectId);
  const [draft, setDraft] = useState("");
  const [view, setView] = useState<"chat" | "history">("chat");
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<AskMode>("ask");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [saveRequest, setSaveRequest] = useState<SaveRequest | null>(null);
  const [taskFrom, setTaskFrom] = useState<string | null>(null);
  const titleId = useId();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  // The saved form of the conversation as last loaded or saved, so a restore
  // does not count as a change and only real changes are written.
  const savedRef = useRef("");
  const createdAtRef = useRef(0);

  const modes = useMemo<AskMode[]>(
    () =>
      BUILD_MODE_AVAILABLE
        ? [
            "ask",
            "build",
            ...(features?.autopilot ? (["autopilot"] as const) : []),
          ]
        : ["ask"],
    [features?.autopilot],
  );
  // Autopilot switched off by an admin falls back to Build.
  useEffect(() => {
    if (!modes.includes(mode))
      setMode(modes.includes("build") ? "build" : "ask");
  }, [modes, mode]);

  const current: AskConversationSummary | null =
    history.conversations.find((item) => item.id === conversationId) ?? null;

  const focusComposer = useCallback(() => {
    window.requestAnimationFrame?.(() => inputRef.current?.focus());
  }, []);

  const restore = useCallback(
    (conversation: AskConversation | null) => {
      setExtras([]);
      if (conversation) {
        load(conversation.turns);
        savedRef.current = JSON.stringify(conversation.turns);
        createdAtRef.current = conversation.createdAt;
        setConversationId(conversation.id);
      } else {
        clear();
        savedRef.current = "";
        createdAtRef.current = 0;
        setConversationId(null);
      }
    },
    [load, clear],
  );

  // A conversation belongs to one person and workspace: on a switch (and on
  // first load) pick up where that workspace's conversation left off.
  const restoredKey = useRef<string | null | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: restore on switch only
  useEffect(() => {
    if (restoredKey.current === history.loadedKey) return;
    restoredKey.current = history.loadedKey;
    const id = history.currentId;
    if (history.mode === "local" || !id) {
      restore(id ? history.find(id) : null);
      return;
    }
    let cancelled = false;
    void history.open(id).then((conversation) => {
      if (!cancelled) restore(conversation);
    });
    return () => {
      cancelled = true;
    };
  }, [history.loadedKey]);

  // A question sent with the open request (palette "Ask AI: …").
  const handledRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!open || !request || request.id === handledRequest.current) return;
    handledRequest.current = request.id;
    setView("chat");
    void ask(request.question);
  }, [open, request, ask]);

  // Save settled conversations; streaming text is saved once it settles.
  // biome-ignore lint/correctness/useExhaustiveDependencies: save on turn changes only
  useEffect(() => {
    if (!history.enabled || session.streaming) return;
    if (session.turns.length === 0) return;
    const turns = toStoredTurns(session.turns);
    const serialized = JSON.stringify(turns);
    if (serialized === savedRef.current) return;
    savedRef.current = serialized;
    const now = Date.now();
    const id = conversationId ?? newConversationId();
    if (!conversationId) {
      createdAtRef.current = now;
      setConversationId(id);
    }
    history.save({
      id,
      projectId,
      createdAt: createdAtRef.current || now,
      updatedAt: now,
      title: customTitle,
      pinned: current?.pinned ?? false,
      turns,
    });
  }, [session.turns, session.streaming, history.enabled]);

  // Nothing of a signed-out person's conversations stays in this browser.
  useEffect(
    () =>
      onSignOut(() => {
        clearAllAskHistory();
        clearAll();
        restore(null);
      }),
    [clearAll, restore],
  );

  // Focus the composer on open; give focus back to where Ask was opened from.
  useEffect(() => {
    if (!visible) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    inputRef.current?.focus();
    return () => {
      const active = document.activeElement;
      if ((!active || active === document.body) && previous?.isConnected) {
        previous.focus();
      }
    };
  }, [visible]);

  const last = session.turns.at(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the stream
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [
    session.turns.length,
    last?.answer.length,
    last?.status,
    last?.reasoning.length,
    view,
    extras.length,
    build.turns.length,
    // A Build turn grows in place: its proposal, then its results.
    build.turns.at(-1)?.status,
    build.turns.at(-1)?.actions.length,
    Object.keys(build.turns.at(-1)?.results ?? {}).length,
  ]);

  const allSources = useMemo(
    () => sourceMap(session.turns.flatMap((turn) => turn.sources)),
    [session.turns],
  );

  const streaming = session.streaming || build.busy;

  const send = (payload: AskComposerPayload) => {
    const text = payload.text.trim();
    if (!text || streaming) return;
    setDraft("");
    if (mode === "ask") {
      void ask(text, {
        context: payload.context,
        attachments: payload.attachments,
        webSearch: payload.webSearch,
        skill: payload.skill,
      });
      return;
    }
    planInBuild(text, payload.context, mode === "autopilot");
  };

  /**
   * One Build request, typed or picked from a question's options: it is
   * listed in the conversation and sees the earlier Ask and Build turns.
   */
  const planInBuild = (
    text: string,
    context: AskComposerPayload["context"],
    autopilot: boolean,
  ) => {
    const index = build.turns.length;
    setExtras((items) => [
      ...items,
      {
        key: `build-${index}-${Date.now()}`,
        after: session.turns.length,
        kind: "build",
        index,
      },
    ]);
    void build.plan(text, {
      history: [
        ...session.turns
          .filter((turn) => turn.status === "done" && turn.answer.trim())
          .map((turn) => ({ question: turn.question, answer: turn.answer })),
        ...historyOf(build.turns),
      ].slice(-6),
      // Build calls people "member"; Ask calls them "user".
      context: context.map(({ kind, id }) => ({
        kind: kind === "user" ? ("member" as const) : kind,
        id,
      })),
      autopilot,
    });
  };

  // Hands-free: what is said is sent as if typed, and the answer is read out.
  const voice = useVoiceMode({
    workspaceId,
    server: features?.speech === true,
    lang: i18n.resolvedLanguage ?? i18n.language ?? "en-US",
    mode,
    askTurns: session.turns,
    buildTurns: build.turns,
    send: (text) =>
      send({
        text,
        context: [],
        attachments: [],
        webSearch: false,
        skill: null,
      }),
    applyBuild: (turnId) => void build.apply(turnId),
    cancelBuild: (turnId) => build.cancel(turnId),
    onError: (error) =>
      toast.error(
        t(
          error === "denied"
            ? "ai:ask.voice.denied"
            : error === "unavailable"
              ? "ai:ask.voice.unavailable"
              : error === "empty"
                ? "ai:ask.voice.empty"
                : error === "blocked"
                  ? "ai:ask.voice.blocked"
                  : "ai:ask.voice.failed",
        ),
      ),
  });

  const sendQuestion = (question: string) => {
    if (streaming) return;
    if (mode !== "ask") setMode("ask");
    void ask(question);
  };

  /** What a summary or a brief is about: a chip, the page, or the scope. */
  const target = (
    context: readonly AskContextItem[],
    kinds: readonly ("page" | "cycle" | "module" | "project")[],
  ) => {
    for (const kind of kinds) {
      const chip = context.find((item) => item.kind === kind);
      if (chip) return { kind, id: chip.id, name: chip.label };
    }
    for (const kind of kinds) {
      if (kind === "project") continue;
      const id = routeId(pathname, `${kind}s`);
      if (id) {
        return {
          kind,
          id,
          name: t(`ai:ask.commands.this.${kind}`),
        };
      }
    }
    if (kinds.includes("project") && projectId) {
      return {
        kind: "project" as const,
        id: projectId,
        name: project?.name ?? t("ai:ask.commands.this.project"),
      };
    }
    return null;
  };

  const runCommand = (command: AskSlashCommand, context: AskContextItem[]) => {
    if (!workspaceId) return;
    if (command === "clear") {
      newConversation();
      return;
    }
    if (command === "create") {
      if (modes.includes("build")) setMode("build");
      else toast.info(t("ai:ask.commands.buildUnavailable"));
      focusComposer();
      return;
    }
    if (command === "translate") {
      const language = languageName(i18n.resolvedLanguage ?? i18n.language);
      if (session.turns.some((turn) => turn.answer.trim())) {
        sendQuestion(t("ai:ask.commands.translatePrompt", { language }));
      } else {
        setDraft(`${t("ai:ask.commands.translatePrefill", { language })} `);
        focusComposer();
      }
      return;
    }
    if (command === "summarize") {
      const found = target(context, ["page", "cycle", "project"]);
      if (!found || found.kind === "module") {
        toast.info(t("ai:ask.commands.summarizeNeedsScope"));
        return;
      }
      const kind = found.kind;
      const streamer: AskStreamer = (handlers) =>
        streamSummary(
          { workspaceId, kind, id: found.id, ...(locale ? { locale } : {}) },
          handlers,
        );
      void session.runCommand(
        t("ai:ask.commands.summarizeTurn", { name: found.name }),
        streamer,
      );
      return;
    }
    if (command === "brief") {
      const found = target(context, ["cycle", "module", "project"]);
      if (!found || found.kind === "page") {
        toast.info(t("ai:ask.commands.briefNeedsScope"));
        return;
      }
      const scopeType = found.kind;
      const streamer: AskStreamer = (handlers) =>
        streamBrief(
          {
            workspaceId,
            scopeType,
            scopeId: found.id,
            audience: "team",
            ...(locale ? { locale } : {}),
          },
          handlers,
        );
      void session.runCommand(
        t("ai:ask.commands.briefTurn", { name: found.name }),
        streamer,
      );
    }
  };

  const sendToAgent = async ({
    agent,
    task,
    text,
  }: {
    agent: AskContextItem;
    task: AskContextItem | null;
    text: string;
  }) => {
    if (!workspaceId || !task) return;
    try {
      const run = await startRun.mutateAsync({
        workspaceId,
        agentId: agent.id,
        taskId: task.id,
        prompt: text,
      });
      setExtras((items) => [
        ...items,
        {
          key: `agent-${run.id}`,
          after: session.turns.length,
          kind: "agent",
          runId: run.id,
        },
      ]);
    } catch (error) {
      const key = aiErrorKey(error);
      toast.error(t(key === "ai:errors.unknown" ? "ai:ask.agent.error" : key));
    }
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (event.nativeEvent.isComposing || fullPage) return;
    event.stopPropagation();
    setOpen(false);
  };

  const openSource = (url: string) => {
    // A docked window can stay open beside the page; a full-screen one
    // would hide what was opened.
    if (coversPage() && !fullPage) setOpen(false);
    navigate({ href: url });
  };

  const newConversation = () => {
    restore(null);
    build.reset();
    history.setCurrent(null);
    setView("chat");
    setRenaming(false);
    focusComposer();
  };

  const reopen = async (summary: AskConversationSummary) => {
    const conversation = await history.open(summary.id);
    if (!conversation) {
      toast.error(t("ai:ask.history.openError"));
      return;
    }
    build.reset();
    restore(conversation);
    history.setCurrent(conversation.id);
    setProjectId(conversation.projectId);
    setView("chat");
    focusComposer();
  };

  const deleteConversation = (id: string) => {
    history.remove(id);
    if (id === conversationId) restore(null);
  };

  const clearHistory = () => {
    history.clearAll();
    restore(null);
  };

  const importHistory = async () => {
    const count = await history.importLocal();
    toast.success(t("ai:ask.history.imported", { total: count }));
  };

  const projectName = (id: string) =>
    projects?.find((item) => item.id === id)?.name;

  // A name the person gave, not the first question it defaults to.
  const firstQuestion = session.turns[0]?.question ?? "";
  const customTitle =
    current?.title &&
    current.title !== firstQuestion &&
    current.title !== firstQuestion.slice(0, MAX_TITLE_CHARS)
      ? current.title
      : null;

  const conversationName =
    current?.title ||
    session.turns[0]?.question.slice(0, MAX_TITLE_CHARS) ||
    "";

  const exportMarkdown = () =>
    conversationMarkdown(
      conversationName || t("ai:ask.title"),
      session.turns.map((turn) => ({
        question: turn.question,
        answer: answerAsMarkdown(
          turn.answer,
          allSources,
          window.location.origin,
        ),
      })),
      { you: t("ai:ask.you"), answer: t("ai:ask.answer") },
    );

  // Where the next question goes (the current settings), so a change of
  // model shows at once; the last answer's model only until that loads.
  const meta = [...session.turns].reverse().find((turn) => turn.meta)?.meta;
  const model = availability.data?.model || meta?.model || null;
  const destination = (availability.data?.destination ||
    meta?.destination ||
    null) as keyof typeof AI_DESTINATION_KEYS | null;
  const modelLabel = model
    ? destination && destination in AI_DESTINATION_KEYS
      ? `${model} · ${t(AI_DESTINATION_KEYS[destination])}`
      : model
    : null;

  if (!visible) return null;

  const suggestions = project ? PROJECT_SUGGESTIONS : WORKSPACE_SUGGESTIONS;
  const showingHistory = view === "history" && !fullPage;
  const pagesAllowed = canCreatePages();
  const tasksAllowed = canCreateTasks();
  const hasTurns = session.turns.length > 0;
  const lastId = session.turns.at(-1)?.id;
  const busy = streaming;

  const extrasAfter = (count: number) =>
    extras
      .filter((item) =>
        count === session.turns.length
          ? item.after >= count
          : item.after === count,
      )
      .map((item) =>
        item.kind === "agent" ? (
          workspaceId ? (
            <li key={item.key}>
              <AskAgentRun workspaceId={workspaceId} runId={item.runId} />
            </li>
          ) : null
        ) : build.turns[item.index] && workspaceId ? (
          <li key={item.key}>
            <AskBuildTurnView
              session={build}
              turn={build.turns[item.index]}
              workspaceId={workspaceId}
              onOpen={openSource}
              onAnswer={(option, autopilot) =>
                planInBuild(option, [], autopilot)
              }
            />
          </li>
        ) : null,
      );

  const historyList = (
    <AskHistoryList
      conversations={history.conversations}
      currentId={conversationId}
      projectName={projectName}
      mode={history.mode}
      isLoading={history.isLoading}
      localCount={history.localCount}
      onOpen={(summary) => void reopen(summary)}
      onDelete={deleteConversation}
      onClear={clearHistory}
      onRename={history.rename}
      onPin={history.setPinned}
      onImport={() => void importHistory()}
    />
  );

  const panel = (
    <section
      {...(fullPage
        ? { role: "region" }
        : { role: "dialog", "aria-modal": "false" as const })}
      aria-labelledby={titleId}
      data-testid="ask-panel"
      data-expanded={expanded || undefined}
      data-full-page={fullPage || undefined}
      aria-busy={streaming}
      onKeyDown={onPanelKeyDown}
      className={cn(
        "flex flex-col overflow-hidden bg-background text-foreground",
        fullPage
          ? "relative h-full min-h-0 w-full flex-1"
          : [
              "fixed inset-0 z-40",
              "transition-[translate,opacity] duration-150 ease-out starting:translate-y-2 starting:opacity-0 motion-reduce:starting:translate-y-0",
              "sm:inset-auto sm:end-4 sm:bottom-4 sm:rounded-xl sm:border sm:shadow-black/10 sm:shadow-xl dark:sm:shadow-black/50",
              expanded
                ? "sm:h-[min(880px,calc(100dvh-2rem))] sm:w-[min(760px,calc(100vw-2rem))]"
                : "sm:h-[min(620px,calc(100dvh-2rem))] sm:w-[min(420px,calc(100vw-2rem))]",
            ],
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <AskAvatar />
        <div className="flex min-w-0 flex-1 flex-col">
          {renaming && conversationId ? (
            <HeaderRename
              initial={conversationName}
              onSave={(title) => {
                setRenaming(false);
                if (title) history.rename(conversationId, title);
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <div className="flex min-w-0 items-baseline gap-2">
              <h2
                id={titleId}
                className="shrink-0 font-semibold text-sm leading-5"
              >
                {t("ai:ask.title")}
              </h2>
              {modelLabel && (
                <span
                  className="truncate text-[11px] text-muted-foreground"
                  title={t("ai:ask.modelLabel", { model: modelLabel })}
                  data-testid="ask-model"
                >
                  {modelLabel}
                </span>
              )}
            </div>
          )}
          <div className="flex min-w-0 items-center text-muted-foreground text-xs">
            {project ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <FolderKanban aria-hidden className="size-3 shrink-0" />
                <span className="truncate">
                  {t("ai:ask.scopeProject", { project: project.name })}
                </span>
                <button
                  type="button"
                  className="rounded-sm p-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label={t("ai:ask.removeScope")}
                  title={t("ai:ask.removeScope")}
                  onClick={() => setProjectId(null)}
                >
                  <X aria-hidden className="size-3" />
                </button>
              </span>
            ) : (
              <span className="truncate">{t("ai:ask.scopeWorkspace")}</span>
            )}
            {customTitle && (
              <span className="ms-1.5 truncate before:me-1.5 before:content-['·']">
                {customTitle}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {history.enabled && !fullPage && (
            <HeaderButton
              label={t("ai:ask.history.title")}
              pressed={showingHistory}
              onClick={() => setView(showingHistory ? "chat" : "history")}
            >
              <History aria-hidden />
            </HeaderButton>
          )}
          <HeaderButton
            label={t("ai:ask.newChat")}
            onClick={newConversation}
            disabled={!hasTurns && extras.length === 0 && !showingHistory}
          >
            <SquarePen aria-hidden />
          </HeaderButton>
          <Menu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <MenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("ai:ask.more")}
                        className="text-muted-foreground hover:text-foreground"
                      />
                    }
                  />
                }
              >
                <MoreHorizontal aria-hidden />
              </TooltipTrigger>
              <TooltipContent>{t("ai:ask.more")}</TooltipContent>
            </Tooltip>
            <MenuPopup align="end">
              <MenuItem
                disabled={!conversationId}
                onClick={() => {
                  setView("chat");
                  setRenaming(true);
                }}
              >
                <Pencil aria-hidden />
                {t("ai:ask.conversation.rename")}
              </MenuItem>
              <MenuItem
                disabled={!conversationId}
                onClick={() =>
                  conversationId &&
                  history.setPinned(conversationId, !current?.pinned)
                }
              >
                {current?.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                {current?.pinned
                  ? t("ai:ask.conversation.unpin")
                  : t("ai:ask.conversation.pin")}
              </MenuItem>
              <MenuItem
                disabled={!hasTurns}
                onClick={() =>
                  download(
                    fileName(conversationName || t("ai:ask.title")),
                    exportMarkdown(),
                  )
                }
              >
                <Download aria-hidden />
                {t("ai:ask.conversation.export")}
              </MenuItem>
              {pagesAllowed && (
                <MenuItem
                  disabled={!hasTurns}
                  onClick={() =>
                    setSaveRequest({
                      title: conversationName || t("ai:ask.title"),
                      content: exportMarkdown()
                        .replace(/^# .*\n+/, "")
                        .trim(),
                    })
                  }
                >
                  <FilePlus2 aria-hidden />
                  {t("ai:ask.conversation.saveAsPage")}
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem
                variant="destructive"
                disabled={!conversationId}
                onClick={() =>
                  conversationId && deleteConversation(conversationId)
                }
              >
                <Trash2 aria-hidden />
                {t("ai:ask.conversation.delete")}
              </MenuItem>
            </MenuPopup>
          </Menu>
          {!fullPage && workspaceId && (
            <HeaderButton
              label={t("ai:ask.openFullPage")}
              onClick={() => {
                useAskPanel.getState().setReturnTo(href);
                void navigate({
                  to: "/dashboard/workspace/$workspaceId/ai",
                  params: { workspaceId },
                });
              }}
              className="max-sm:hidden"
            >
              <ExternalLink aria-hidden />
            </HeaderButton>
          )}
          {!fullPage && (
            <HeaderButton
              label={expanded ? t("ai:ask.collapse") : t("ai:ask.expand")}
              onClick={() => setExpanded((value) => !value)}
              className="max-sm:hidden"
            >
              {expanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
            </HeaderButton>
          )}
          <HeaderButton
            label={t("common:actions.close")}
            onClick={() => {
              if (!fullPage) {
                setOpen(false);
                return;
              }
              // Back to the page the full view was opened from, or home.
              const { returnTo, setReturnTo } = useAskPanel.getState();
              setReturnTo(null);
              if (returnTo) void navigate({ href: returnTo });
              else if (workspaceId)
                void navigate({
                  to: "/dashboard/workspace/$workspaceId",
                  params: { workspaceId },
                });
            }}
          >
            <X aria-hidden />
          </HeaderButton>
        </div>
      </header>

      {showingHistory ? (
        historyList
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div
              className={cn(
                "flex min-h-full flex-col",
                fullPage && "mx-auto w-full max-w-3xl",
              )}
            >
              {!hasTurns && extras.length === 0 ? (
                <div className="flex flex-1 flex-col justify-end gap-4 pb-1">
                  <div className="flex gap-2.5">
                    <AskAvatar />
                    <div className="flex min-w-0 flex-col gap-1 pt-0.5">
                      <p className="font-medium text-sm">
                        {t("ai:ask.greeting")}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {t("ai:ask.description")}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 ps-9.5">
                    <p className="text-muted-foreground text-xs">
                      {t("ai:ask.examples.title")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestions.map((key) => (
                        <button
                          key={key}
                          type="button"
                          className="rounded-full border bg-background px-3 py-1 text-start text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/32 dark:hover:bg-input/64"
                          onClick={() => sendQuestion(t(key))}
                        >
                          {t(key)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <ol className="flex flex-col gap-4">
                  {/* With no Ask turns the last call below lists them all. */}
                  {hasTurns && extrasAfter(0)}
                  {session.turns.map((turn, index) => (
                    <li key={turn.id} className="flex flex-col gap-3">
                      <AskTurnView
                        turn={turn}
                        allSources={allSources}
                        onOpen={openSource}
                        isLast={turn.id === lastId}
                        busy={busy}
                        actions={{
                          onRegenerate: () => void session.regenerate(turn.id),
                          onEdit: (question) =>
                            void session.edit(turn.id, question),
                          onVersion: (version) =>
                            session.setVersion(turn.id, version),
                          onRate: (rating, reason) => {
                            session.rate(turn.id, rating);
                            if (!workspaceId) return;
                            sendFeedback.mutate({
                              workspaceId,
                              feature: "ask",
                              rating,
                              ...(reason ? { reason } : {}),
                              ...(turn.meta?.provider
                                ? { provider: turn.meta.provider }
                                : {}),
                              ...(turn.meta?.model
                                ? { model: turn.meta.model }
                                : {}),
                            });
                          },
                          onFollowUp: sendQuestion,
                          ...(pagesAllowed
                            ? {
                                onSaveAsPage: (markdown: string) =>
                                  setSaveRequest({
                                    title: turn.question.slice(0, 200),
                                    content: markdown,
                                  }),
                              }
                            : {}),
                          ...(tasksAllowed
                            ? { onCreateTask: setTaskFrom }
                            : {}),
                        }}
                      />
                      {index < session.turns.length - 1 &&
                        extrasAfter(index + 1).length > 0 && (
                          <ol className="flex flex-col gap-4">
                            {extrasAfter(index + 1)}
                          </ol>
                        )}
                    </li>
                  ))}
                  {extrasAfter(session.turns.length)}
                </ol>
              )}
              <div ref={endRef} />
            </div>
          </div>

          <div
            className={cn(
              "shrink-0 px-3 pt-1 pb-2.5",
              fullPage && "mx-auto w-full max-w-3xl",
            )}
          >
            <AskComposer
              workspaceId={workspaceId}
              draft={draft}
              onDraftChange={setDraft}
              inputRef={inputRef}
              streaming={streaming}
              onStop={session.stop}
              mode={mode}
              modes={modes}
              onModeChange={setMode}
              features={{
                webSearch: features?.webSearch === true,
                speech: features?.speech === true,
                attachments: true,
              }}
              skills={(skillsQuery.data ?? []).map((skill) => ({
                id: skill.id,
                name: skill.name,
                description: skill.description ?? "",
              }))}
              lang={i18n.resolvedLanguage ?? i18n.language ?? "en-US"}
              onSend={send}
              voice={voice}
              onCommand={runCommand}
              onSendToAgent={(payload) => void sendToAgent(payload)}
            />
            <p className="mt-1.5 px-1 text-center text-[11px] text-muted-foreground leading-4">
              {t("ai:ask.disclaimer")}
            </p>
          </div>
        </>
      )}
      {saveRequest && workspaceId && (
        <AskSaveDialog
          workspaceId={workspaceId}
          projects={projects ?? []}
          defaultProjectId={projectId}
          title={saveRequest.title}
          content={saveRequest.content}
          onClose={() => setSaveRequest(null)}
        />
      )}
      {taskFrom !== null && (
        <CreateTaskModal
          open
          projectId={projectId ?? undefined}
          prefill={{
            title: (last?.question ?? "").slice(0, 200),
            description: taskFrom,
          }}
          onClose={() => setTaskFrom(null)}
        />
      )}
    </section>
  );

  if (fullPage && slot) {
    return createPortal(
      <div className="flex h-full min-h-0 w-full">
        {history.enabled && (
          <aside
            aria-label={t("ai:ask.history.title")}
            className="flex w-72 shrink-0 flex-col border-e max-md:hidden"
          >
            <h2 className="shrink-0 px-4 pt-3 font-semibold text-sm">
              {t("ai:ask.history.title")}
            </h2>
            {historyList}
          </aside>
        )}
        {panel}
      </div>,
      slot,
    );
  }
  return panel;
}

function HeaderRename({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (title: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(value.trim());
      }}
    >
      <Input
        ref={inputRef}
        size="sm"
        value={value}
        maxLength={MAX_TITLE_CHARS}
        aria-label={t("ai:ask.history.renameLabel")}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        className="min-w-0 flex-1"
      />
      <Button
        type="submit"
        variant="ghost"
        size="icon-xs"
        aria-label={t("ai:ask.history.saveTitle")}
        disabled={!value.trim()}
      >
        <Check aria-hidden />
      </Button>
    </form>
  );
}

function HeaderButton({
  label,
  onClick,
  children,
  pressed,
  disabled,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            className={cn(
              "text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground",
              className,
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
