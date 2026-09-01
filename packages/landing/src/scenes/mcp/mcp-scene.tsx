"use client";

import { ArrowUp, Bot, Check, Globe, LoaderCircle } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo } from "react";
import { type LandingCopy, useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  type Step,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import {
  Avatar,
  Board,
  BoardColumn,
  type Priority,
  ProjectTile,
  ReplicaShell,
  TaskCard,
} from "../../replica";
import {
  initialMcpState,
  MCP_TASKS,
  type McpAction,
  type McpState,
  type McpTaskId,
  mcpReducer,
} from "./state";

type Demo = LandingCopy["demo"];

const NEW_TASKS: Record<McpTaskId, { number: number; priority: Priority }> = {
  announcement: { number: 32, priority: "high" },
  pressKit: { number: 33, priority: "medium" },
  monitoring: { number: 34, priority: "medium" },
};

/** An agent connected over MCP creates three tasks on the board. */
export function createMcpScene(demo: Demo): DemoScene<McpState, McpAction> {
  return {
    id: "mcp",
    initialState: initialMcpState,
    reducer: mcpReducer,
    script: [
      step.wait(700),
      step.click("mcp-input", { type: "focus" }),
      step.type(
        "mcp-input",
        demo.mcp.prompt,
        (value) => ({ type: "input", value }),
        20,
      ),
      step.wait(350),
      step.key("Enter", { type: "send" }),
      step.wait(900),
      ...MCP_TASKS.flatMap((id): Step<McpAction>[] => [
        step.set({ type: "create", id }),
        step.wait(750),
      ]),
      step.set({ type: "reply" }),
      step.wait(3200),
    ],
    render: (props) => <McpView {...props} />,
  };
}

function ViaMcp({ label }: { label: string }) {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded border border-primary/25 bg-primary/8 px-1.5 font-medium text-[10px] text-primary">
      <Bot aria-hidden className="size-3" />
      {label}
    </span>
  );
}

function McpView({
  state,
  dispatch,
  interactive,
  compact,
}: SceneRenderProps<McpState, McpAction>) {
  const demo = useLandingCopy().demo;
  const copy = demo.mcp;
  const key = (number: number) => `${demo.hero.projectKey}-${number}`;

  // After the visitor takes over, a sent prompt plays out on its own.
  useEffect(() => {
    if (!interactive || state.prompt === null || state.replied) return;
    const next = MCP_TASKS.find((id) => !state.created.includes(id));
    const timer = setTimeout(
      () => dispatch(next ? { type: "create", id: next } : { type: "reply" }),
      next === MCP_TASKS[0] ? 900 : 700,
    );
    return () => clearTimeout(timer);
  }, [interactive, state.prompt, state.created, state.replied, dispatch]);

  const created = [...state.created].reverse();
  const latest = state.created[state.created.length - 1];

  // The agent: a generic chat client connected to Margaya's MCP server.
  const agent = (
    <section
      className={cn(
        "flex shrink-0 flex-col border-border bg-card",
        compact ? "h-[340px] border-b" : "w-[300px] border-r",
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-border border-b px-3">
        <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-foreground">
          <Bot aria-hidden className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold text-[13px] text-foreground leading-4">
            {copy.agent}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground leading-4">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            <span className="truncate">{copy.connected}</span>
          </span>
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-hidden p-3 text-[13px]">
        {state.prompt !== null && (
          <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-foreground leading-5">
            {state.prompt}
          </p>
        )}
        {state.prompt !== null && (
          <ul className="flex flex-col gap-1.5">
            {MCP_TASKS.map((id, index) => {
              const done = state.created.includes(id);
              const running = !done && index === state.created.length;
              if (!done && !running) return null;
              return (
                <li
                  key={id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                >
                  {done ? (
                    <Check
                      aria-hidden
                      className="size-3.5 shrink-0 text-success"
                    />
                  ) : (
                    <LoaderCircle
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin"
                    />
                  )}
                  <span className="shrink-0 font-mono text-[11px] text-foreground">
                    {copy.tool}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {copy.tasks[id]}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {state.replied && (
          <p className="max-w-[90%] text-foreground leading-5">{copy.reply}</p>
        )}
      </div>
      <div className="shrink-0 p-3 pt-0">
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-xl border bg-background ps-3 pe-1.5 transition-colors",
            state.focused
              ? "border-ring/60 ring-2 ring-ring/15"
              : "border-input",
          )}
        >
          <input
            data-demo="mcp-input"
            type="text"
            value={state.input}
            aria-label={copy.placeholder}
            placeholder={copy.placeholder}
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
            className="h-10 min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            aria-label={copy.send}
            onClick={() => dispatch({ type: "send" })}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-primary text-primary-foreground"
          >
            <ArrowUp aria-hidden className="size-4" />
          </button>
        </div>
      </div>
    </section>
  );

  return (
    <ReplicaShell panel={compact ? undefined : agent}>
      {compact && agent}
      {/* The project board, where the agent's tasks land. */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-border/80 border-b px-3 font-semibold text-[15px] text-foreground">
          <ProjectTile icon={Globe} className="size-5" />
          <span className="truncate">{demo.projects.website}</span>
          <span className="font-normal text-muted-foreground text-sm">
            · {demo.shell.views.board}
          </span>
          <span className="ms-auto">
            <Avatar name={demo.people.adam.name} size="md" />
          </span>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Board>
            <BoardColumn
              status="todo"
              title={demo.statuses.todo}
              count={state.created.length + 1}
            >
              {created.map((id) => (
                <TaskCard
                  key={id}
                  data-demo={`mcp-card-${id}`}
                  taskKey={key(NEW_TASKS[id].number)}
                  title={copy.tasks[id]}
                  priority={NEW_TASKS[id].priority}
                  selected={id === latest && !state.replied}
                  chips={<ViaMcp label={copy.via} />}
                />
              ))}
              <TaskCard
                taskKey={key(18)}
                title={demo.hero.tasks.onboarding}
                priority="medium"
                assignees={[demo.people.mira.name]}
              />
            </BoardColumn>
            <BoardColumn
              status="inProgress"
              title={demo.statuses.inProgress}
              count={1}
            >
              <TaskCard
                taskKey={key(15)}
                title={demo.hero.tasks.export}
                priority="high"
                assignees={[demo.people.jonas.name]}
              />
            </BoardColumn>
          </Board>
        </div>
      </section>
    </ReplicaShell>
  );
}

/** The MCP demo. */
export function McpDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createMcpScene(copy.demo), [copy.demo]);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.mcp.caption}
      description={copy.scenes.mcp.description}
      size={{ width: 760, height: 560 }}
      compactSize={{ width: 480, height: 820 }}
      compactBelow={420}
      className={className}
    />
  );
}
