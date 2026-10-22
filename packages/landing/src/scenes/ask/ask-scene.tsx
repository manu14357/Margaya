"use client";

import {
  ArrowUp,
  BookOpen,
  Brain,
  Check,
  ChevronRight,
  Globe,
  Pencil,
  Plus,
  Sparkles,
  SquareCheck,
  Undo2,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo } from "react";
import { fill, type LandingCopy, useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import {
  Board,
  BoardColumn,
  IconRail,
  ProjectTile,
  ProjectViewTabs,
  ReplicaButton,
  ReplicaShell,
  TaskCard,
  TopBar,
} from "../../replica";
import {
  type AskAction,
  type AskMode,
  type AskState,
  type AskTurn,
  busyTurn,
  createAskReducer,
  initialAskState,
} from "./state";

type Demo = LandingCopy["demo"];

const MODES: readonly AskMode[] = ["ask", "build"];

/**
 * Ask AI on a board: a question answered from the workspace, then a Build
 * request that proposes one change, confirmed by hand.
 */
export function createAskScene(demo: Demo): DemoScene<AskState, AskAction> {
  const copy = demo.ask;
  // Reads, thinks for two seconds, then answers.
  const reply = [
    step.wait<AskAction>(450),
    step.set<AskAction>({ type: "read" }),
    step.wait<AskAction>(950),
    step.set<AskAction>({ type: "tick" }),
    step.wait<AskAction>(800),
    step.set<AskAction>({ type: "answer" }),
  ];
  return {
    id: "ask",
    initialState: initialAskState,
    reducer: createAskReducer({ ask: copy.question, build: copy.buildPrompt }),
    script: [
      step.wait(700),
      step.click("ask-input", { type: "focus" }),
      step.type(
        "ask-input",
        copy.question,
        (value) => ({ type: "input", value }),
        24,
      ),
      step.wait(250),
      step.click("ask-send", { type: "send" }),
      ...reply,
      step.wait(2000),
      step.click("ask-mode-build", { type: "mode", mode: "build" }),
      step.click("ask-input", { type: "focus" }),
      step.type(
        "ask-input",
        copy.buildPrompt,
        (value) => ({ type: "input", value }),
        22,
      ),
      step.wait(250),
      step.click("ask-send", { type: "send" }),
      ...reply,
      step.wait(1300),
      step.click("ask-confirm", { type: "confirm" }),
      step.wait(1500),
      step.set({ type: "settle" }),
      step.wait(2400),
    ],
    render: (props) => <AskView {...props} />,
  };
}

/** The small round mark beside the AI's messages. */
function AskAvatar() {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-foreground"
    >
      <Sparkles className="size-3.5" />
    </span>
  );
}

/** A cited task key inside an answer. */
function KeyChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-md border border-border bg-muted/60 px-1.5 font-mono text-[11px] text-foreground">
      {children}
    </span>
  );
}

function Bubble({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-muted px-3.5 py-2 text-foreground text-sm leading-5">
      {children}
    </p>
  );
}

/** "Context (n)": what the turn read. Open while it thinks, folded after. */
function ContextRow({
  label,
  open,
  rows,
}: {
  label: string;
  open: boolean;
  rows: readonly ReactNode[];
}) {
  return (
    <div className="text-muted-foreground text-xs">
      <span className="inline-flex items-center gap-1.5">
        <BookOpen aria-hidden className="size-3.5 shrink-0" />
        {label}
        <ChevronRight
          aria-hidden
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
      </span>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-1 border-border border-s-2 ps-2.5">
          {rows.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed rows
            <li key={index} className="flex min-w-0 items-center gap-1.5">
              {row}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskRow({ taskKey, title }: { taskKey: string; title: string }) {
  return (
    <>
      <SquareCheck aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 truncate">
        {taskKey} {title}
      </span>
    </>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex h-7 items-center gap-1">
      {["0ms", "150ms", "300ms"].map((delay) => (
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

function AskView({
  state,
  dispatch,
  interactive,
  compact,
}: SceneRenderProps<AskState, AskAction>) {
  const demo = useLandingCopy().demo;
  const copy = demo.ask;
  const key = (number: number) => `${demo.hero.projectKey}-${number}`;
  const mira = demo.people.mira.name;
  const busy = busyTurn(state);

  // After the visitor takes over, a sent message plays out on its own.
  useEffect(() => {
    if (!interactive) return;
    let next: AskAction | null = null;
    let delay = 0;
    if (busy?.phase === "reading") {
      next = { type: "read" };
      delay = 450;
    } else if (busy?.phase === "thinking") {
      next = busy.seconds < 2 ? { type: "tick" } : { type: "answer" };
      delay = busy.seconds < 2 ? 950 : 800;
    } else if (state.highlight) {
      next = { type: "settle" };
      delay = 1500;
    }
    if (!next) return;
    const action = next;
    const timer = setTimeout(() => dispatch(action), delay);
    return () => clearTimeout(timer);
  }, [interactive, busy, state.highlight, dispatch]);

  const pageTitles = copy.tasks.pageTitles;
  const pricing = copy.tasks.pricing;
  const blocked = [{ name: copy.blocked, color: "red" as const }];

  const contextRows = (turn: AskTurn, index: number) => {
    const rows: ReactNode[] = [copy.facts];
    if (turn.reply === "blockers") {
      rows.push(<TaskRow taskKey={key(5)} title={pageTitles} />);
      rows.push(<TaskRow taskKey={key(6)} title={pricing} />);
    }
    if (turn.reply === "assign") {
      rows.push(<TaskRow taskKey={key(5)} title={pageTitles} />);
    }
    if (index > 0) rows.push(fill(copy.earlier, { count: index }));
    return rows;
  };

  const answerOf = (turn: AskTurn) => {
    if (turn.reply === "generic") {
      return (
        <p className="text-foreground text-sm leading-5">
          {turn.mode === "build" ? copy.genericBuild : copy.generic}
        </p>
      );
    }
    if (turn.reply === "blockers") {
      return (
        <div className="flex flex-col gap-1.5 text-foreground text-sm leading-5">
          <p>{fill(copy.blockedIntro, { cycle: demo.hero.cycle })}</p>
          <ul className="flex flex-col gap-1.5">
            <li className="flex items-start gap-1.5">
              <KeyChip>{key(5)}</KeyChip>
              <span>{fill(copy.blockedPageTitles, { title: pageTitles })}</span>
            </li>
            <li className="flex items-start gap-1.5">
              <KeyChip>{key(6)}</KeyChip>
              <span>{fill(copy.blockedPricing, { title: pricing })}</span>
            </li>
          </ul>
          <p>{fill(copy.unassigned, { key: key(5) })}</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        <p className="text-foreground text-sm leading-5">{copy.summary}</p>
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2.5">
          <div className="flex items-start gap-2">
            <span
              aria-hidden
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
            >
              <Pencil className="size-3.5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-muted-foreground text-xs">{copy.op}</span>
              <span className="font-medium text-foreground text-sm">
                {fill(copy.action, { key: key(5), name: mira })}
              </span>
              <span className="truncate text-muted-foreground text-xs">
                {pageTitles}
              </span>
            </span>
          </div>
          {(turn.change === "applied" || turn.change === "undone") && (
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 text-foreground">
                <Check aria-hidden className="size-3.5 text-primary" />
                {copy.done}
              </span>
              {turn.change === "undone" ? (
                <span className="text-muted-foreground">{copy.undone}</span>
              ) : (
                <button
                  type="button"
                  data-demo="ask-undo"
                  onClick={() => dispatch({ type: "undo" })}
                  className="ms-auto inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Undo2 aria-hidden className="size-3.5" />
                  {copy.undo}
                </button>
              )}
            </div>
          )}
        </div>
        {turn.change === "ready" && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5">
            <p className="min-w-0 flex-1 text-foreground text-sm">
              <span className="font-medium">{copy.awaiting}</span>
              <span aria-hidden className="text-muted-foreground">
                {" · "}
              </span>
              <span className="text-muted-foreground">
                {fill(copy.ready, { count: 1 })}
              </span>
            </p>
            <span className="flex gap-1.5">
              <button
                type="button"
                data-demo="ask-cancel"
                onClick={() => dispatch({ type: "cancel" })}
                className="h-6 cursor-pointer rounded-md px-2 font-medium text-foreground text-xs hover:bg-accent"
              >
                {copy.cancel}
              </button>
              <button
                type="button"
                data-demo="ask-confirm"
                onClick={() => dispatch({ type: "confirm" })}
                className="h-6 cursor-pointer rounded-md bg-primary px-2 font-medium text-primary-foreground text-xs"
              >
                {copy.confirm}
              </button>
            </span>
          </div>
        )}
        {turn.change === "cancelled" && (
          <p className="text-muted-foreground text-xs">{copy.cancelled}</p>
        )}
      </div>
    );
  };

  const turnView = (turn: AskTurn, index: number) => {
    const live = turn.phase === "thinking";
    return (
      <li key={index} className="flex flex-col gap-3">
        <Bubble>
          <span className="sr-only">{copy.you}: </span>
          {turn.prompt}
        </Bubble>
        <div className="flex gap-2.5">
          <AskAvatar />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
            {turn.phase === "reading" ? (
              <TypingDots />
            ) : (
              <>
                <ContextRow
                  label={fill(copy.context, {
                    count: contextRows(turn, index).length,
                  })}
                  open={live}
                  rows={contextRows(turn, index)}
                />
                <p className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Brain aria-hidden className="size-3.5 shrink-0" />
                  <span className={cn(live && "motion-safe:animate-pulse")}>
                    {fill(live ? copy.thinking : copy.thought, {
                      seconds: turn.seconds,
                    })}
                  </span>
                </p>
              </>
            )}
            {turn.phase === "done" && answerOf(turn)}
          </div>
        </div>
      </li>
    );
  };

  const placeholder =
    state.mode === "ask" ? copy.placeholder : copy.placeholderBuild;

  const chat = (
    <aside
      className={cn(
        "flex min-h-0 shrink-0 flex-col border-border bg-background",
        compact ? "flex-1 border-t" : "w-[400px] border-s",
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-border border-b px-3">
        <AskAvatar />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-semibold text-foreground text-sm leading-5">
              {copy.title}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {copy.model}
            </span>
          </span>
          <span className="truncate text-muted-foreground text-xs leading-4">
            {demo.projects.website}
          </span>
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-3 pt-3">
        {state.turns.length === 0 ? (
          <div className="flex gap-2.5 pb-1">
            <AskAvatar />
            <div className="flex min-w-0 flex-col gap-1 pt-0.5">
              <p className="font-medium text-foreground text-sm">
                {copy.greeting}
              </p>
              <p className="text-muted-foreground text-sm leading-5">
                {copy.intro}
              </p>
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-5">{state.turns.map(turnView)}</ol>
        )}
      </div>
      <div className="shrink-0 p-3">
        <div
          className={cn(
            "relative flex flex-col gap-1 rounded-2xl border bg-background p-1.5 transition-colors",
            state.focused
              ? "border-ring/60 ring-[3px] ring-ring/15"
              : "border-input",
          )}
        >
          {busy && (
            // The quiet busy cue: the composer's border breathes.
            <span
              aria-hidden
              className="pointer-events-none absolute -inset-px rounded-2xl border border-primary/55 ring-[3px] ring-primary/15 motion-safe:animate-pulse"
            />
          )}
          <input
            data-demo="ask-input"
            type="text"
            value={state.input}
            aria-label={placeholder}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            onFocus={() => dispatch({ type: "focus" })}
            onChange={(event) =>
              dispatch({ type: "input", value: event.target.value })
            }
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                event.preventDefault();
                dispatch({ type: "send" });
              }
            }}
            className="h-8 min-w-0 bg-transparent px-2 text-foreground text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-0.5">
            <fieldset
              aria-label={copy.modes.label}
              className="me-1 inline-flex items-center rounded-full border border-border p-0.5"
            >
              {MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  data-demo={`ask-mode-${mode}`}
                  aria-pressed={state.mode === mode}
                  onClick={() => dispatch({ type: "mode", mode })}
                  className="cursor-pointer rounded-full px-2 py-0.5 text-muted-foreground text-xs transition-colors hover:text-foreground aria-pressed:bg-accent aria-pressed:font-medium aria-pressed:text-foreground"
                >
                  {copy.modes[mode]}
                </button>
              ))}
            </fieldset>
            <button
              type="button"
              data-demo="ask-send"
              aria-label={copy.send}
              disabled={!state.input.trim() || !!busy}
              onClick={() => dispatch({ type: "send" })}
              className="ms-auto flex size-8 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground disabled:cursor-default disabled:opacity-60"
            >
              <ArrowUp aria-hidden className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );

  const board = (
    <Board>
      <BoardColumn status="todo" title={demo.statuses.todo} count={3}>
        <TaskCard
          data-demo="ask-card-web5"
          taskKey={key(5)}
          title={pageTitles}
          labels={blocked}
          priority="high"
          assignees={state.assigned ? [mira] : []}
          selected={state.highlight}
        />
        <TaskCard
          taskKey={key(6)}
          title={pricing}
          labels={blocked}
          priority="medium"
          assignees={[demo.people.jonas.name]}
        />
        <TaskCard
          taskKey={key(18)}
          title={demo.hero.tasks.onboarding}
          priority="medium"
          assignees={[mira]}
        />
      </BoardColumn>
      <BoardColumn
        status="inProgress"
        title={demo.statuses.inProgress}
        count={2}
      >
        <TaskCard
          taskKey={key(15)}
          title={demo.hero.tasks.export}
          priority="high"
          assignees={[demo.people.jonas.name]}
        />
        <TaskCard
          taskKey={key(7)}
          title={copy.tasks.mobileMenu}
          priority="low"
          assignees={[demo.people.priya.name]}
        />
      </BoardColumn>
    </Board>
  );

  return (
    <ReplicaShell
      rail={
        compact ? undefined : (
          <IconRail active="projects" user={demo.people.adam.name} />
        )
      }
    >
      <TopBar
        compact={compact}
        place={
          <>
            <ProjectTile icon={Globe} seed="web" className="size-5" />
            <span className="truncate">{demo.projects.website}</span>
          </>
        }
        actions={
          compact ? undefined : (
            <ReplicaButton variant="primary" icon={Plus}>
              {demo.shell.newTask}
            </ReplicaButton>
          )
        }
      />
      {compact ? (
        <>
          <div className="h-[268px] shrink-0 overflow-hidden">{board}</div>
          {chat}
        </>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <ProjectViewTabs active="board" />
            <div className="min-h-0 flex-1 overflow-hidden">{board}</div>
          </div>
          {chat}
        </div>
      )}
    </ReplicaShell>
  );
}

/** The Ask AI → Build demo. */
export function AskDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createAskScene(copy.demo), [copy.demo]);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.ask.caption}
      description={copy.scenes.ask.description}
      size={{ width: 1280, height: 800 }}
      compactSize={{ width: 480, height: 820 }}
      className={className}
    />
  );
}
