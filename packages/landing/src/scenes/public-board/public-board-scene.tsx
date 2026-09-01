"use client";

import { ArrowBigDown, ArrowBigUp, Globe, Search, Send, X } from "lucide-react";
import { useMemo } from "react";
import { fill, type LandingCopy, useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import {
  AvatarStack,
  ReplicaShell,
  StatusChip,
  type StatusId,
} from "../../replica";
import { NoticeToast } from "../../replica/notice-toast";
import {
  initialPublicBoardState,
  PUBLIC_COLUMNS,
  type PublicBoardAction,
  type PublicBoardState,
  type PublicColumnId,
  type PublicTaskId,
  publicBoardReducer,
} from "./state";

type Demo = LandingCopy["demo"];

const NUMBERS: Record<PublicTaskId, number> = {
  sso: 41,
  offline: 44,
  commentHooks: 47,
  export: 15,
  search: 38,
  darkMode: 12,
};

const DOWNVOTES: Record<PublicTaskId, number> = {
  sso: 2,
  offline: 1,
  commentHooks: 3,
  export: 0,
  search: 1,
  darkMode: 0,
};

const ASSIGNEES: Record<PublicTaskId, (keyof Demo["people"])[]> = {
  sso: ["jonas"],
  offline: ["priya", "sam"],
  commentHooks: [],
  export: ["jonas", "adam"],
  search: ["sam"],
  darkMode: ["mira"],
};

const COLUMN_STATUS: Record<PublicColumnId, StatusId> = {
  planned: "todo",
  inProgress: "inProgress",
  shipped: "done",
};

/** The card's leading edge, by column group, like the public board's. */
const EDGE: Record<PublicColumnId, string> = {
  planned: "bg-info",
  inProgress: "bg-warning",
  shipped: "bg-success",
};

/** A public roadmap: votes arrive, the visitor upvotes and sends a request. */
export function createPublicBoardScene(
  demo: Demo,
): DemoScene<PublicBoardState, PublicBoardAction> {
  return {
    id: "public-board",
    initialState: initialPublicBoardState,
    reducer: publicBoardReducer,
    script: [
      step.wait(800),
      step.set({ type: "remoteVote", id: "export" }),
      step.wait(700),
      step.click("pb-card-offline", { type: "open", id: "offline" }),
      step.wait(500),
      step.click("pb-upvote", { type: "upvote", id: "offline" }),
      step.wait(700),
      step.set({ type: "remoteVote", id: "sso" }),
      step.wait(500),
      step.click("pb-close", { type: "close" }),
      step.wait(300),
      step.click("pb-submit", { type: "openRequest" }),
      step.wait(400),
      step.click("pb-request-title"),
      step.type(
        "pb-request-title",
        demo.publicBoard.typed,
        (value) => ({ type: "typeRequest", value }),
        18,
      ),
      step.wait(400),
      step.click("pb-request-send", { type: "sendRequest" }),
      step.wait(700),
      step.set({ type: "remoteVote", id: "export" }),
      step.wait(2600),
    ],
    render: (props) => <PublicBoardView {...props} />,
  };
}

function VoteCount({
  count,
  mine,
  bumped,
}: {
  count: number;
  mine: boolean;
  bumped: boolean;
}) {
  return (
    <span
      className={cn(
        "ms-auto inline-flex h-5 items-center gap-0.5 rounded-md px-1 text-[11px] tabular-nums transition-[background-color,color,transform] duration-300",
        mine || bumped
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground",
        bumped && "scale-110",
      )}
    >
      <ArrowBigUp
        aria-hidden
        className={cn("size-3.5", mine && "fill-current")}
      />
      {count}
    </span>
  );
}

function PublicBoardView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<PublicBoardState, PublicBoardAction>) {
  const demo = useLandingCopy().demo;
  const copy = demo.publicBoard;
  const key = (id: PublicTaskId) => `${demo.hero.projectKey}-${NUMBERS[id]}`;
  const columns = compact ? PUBLIC_COLUMNS.slice(0, 2) : PUBLIC_COLUMNS;
  const peekColumn = PUBLIC_COLUMNS.find((column) =>
    state.peek ? column.tasks.includes(state.peek) : false,
  );

  return (
    <ReplicaShell>
      <header className="flex min-h-13 shrink-0 items-center gap-3 border-border border-b bg-background px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[28%] bg-muted">
            <Globe aria-hidden className="size-4 text-muted-foreground" />
          </span>
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate font-semibold text-[15px] text-foreground leading-5">
                {copy.title}
              </h1>
              <span className="inline-flex h-4.5 shrink-0 items-center rounded-sm border border-border px-1.5 font-medium text-[10px] text-muted-foreground">
                {copy.badge}
              </span>
            </div>
            {!compact && (
              <p className="truncate text-muted-foreground text-xs">
                {copy.description}
              </p>
            )}
          </div>
        </div>
        {!compact && (
          <span className="flex h-8 w-72 items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-muted-foreground text-xs dark:bg-input/32">
            <Search aria-hidden className="size-3.5" />
            {copy.search}
          </span>
        )}
        <div className="flex flex-1 items-center justify-end">
          <button
            type="button"
            data-demo="pb-submit"
            onClick={() => dispatch({ type: "openRequest" })}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 font-medium text-foreground text-xs shadow-xs/5 hover:bg-accent dark:bg-input/32"
          >
            <Send aria-hidden className="size-3.5" />
            {copy.submit}
          </button>
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-1 gap-3 p-3">
          {columns.map((column) => (
            <section
              key={column.id}
              className="flex h-full min-h-0 w-[300px] shrink-0 flex-col rounded-xl bg-muted/50 dark:bg-card/60"
            >
              <div className="flex h-9 items-center gap-1.5 px-3">
                <h2 className="font-medium text-[13px] text-foreground">
                  {copy.columns[column.id]}
                </h2>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {column.tasks.length}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 px-1.5 pb-1.5">
                {column.tasks.map((id) => (
                  <button
                    key={id}
                    type="button"
                    data-demo={`pb-card-${id}`}
                    onClick={() => dispatch({ type: "open", id })}
                    className={cn(
                      "relative w-full cursor-pointer overflow-hidden rounded-lg border bg-card py-2 ps-3 pe-2.5 text-left shadow-xs/5 transition-[border-color,box-shadow] duration-150",
                      state.peek === id
                        ? "border-ring/40 ring-1 ring-ring/30"
                        : "border-border hover:border-ring/40",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-y-0 left-0 w-0.5",
                        EDGE[column.id],
                      )}
                    />
                    <span className="mb-1 flex items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {key(id)}
                      </span>
                      {ASSIGNEES[id].length > 0 && (
                        <span className="ms-auto">
                          <AvatarStack
                            names={ASSIGNEES[id].map(
                              (person) => demo.people[person].name,
                            )}
                            size="xs"
                            ring="card"
                          />
                        </span>
                      )}
                    </span>
                    <span className="line-clamp-2 block font-medium text-foreground text-sm leading-snug">
                      {copy.tasks[id]}
                    </span>
                    <span className="mt-2 flex items-center">
                      <VoteCount
                        count={state.votes[id]}
                        mine={state.mine === id}
                        bumped={state.bumped === id}
                      />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* The task peek, with the vote buttons. */}
        <aside
          aria-hidden={!state.peek}
          className={cn(
            "absolute inset-y-0 right-0 z-20 flex flex-col border-border border-l bg-background shadow-xl transition-transform duration-300 ease-out",
            compact ? "w-full" : "w-[380px]",
            state.peek ? "translate-x-0" : "translate-x-full",
          )}
        >
          {state.peek && peekColumn && (
            <div className="flex flex-col gap-4 p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-muted-foreground text-xs">
                  {key(state.peek)}
                </span>
                <button
                  type="button"
                  data-demo="pb-close"
                  aria-label={copy.close}
                  onClick={() => dispatch({ type: "close" })}
                  className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
              <h2 className="font-semibold text-foreground text-lg leading-snug">
                {copy.tasks[state.peek]}
              </h2>
              <StatusChip
                status={COLUMN_STATUS[peekColumn.id]}
                label={copy.columns[peekColumn.id]}
                className="self-start"
              />
              <section
                aria-label={copy.votes}
                className="flex items-center gap-2"
              >
                <button
                  type="button"
                  data-demo="pb-upvote"
                  aria-pressed={state.mine === state.peek}
                  aria-label={fill(copy.upvote, {
                    count: state.votes[state.peek],
                  })}
                  onClick={() =>
                    state.peek && dispatch({ type: "upvote", id: state.peek })
                  }
                  className={cn(
                    "flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 font-medium text-sm tabular-nums",
                    state.mine === state.peek
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-input bg-background text-foreground",
                  )}
                >
                  <ArrowBigUp
                    aria-hidden
                    className={cn(
                      "size-4",
                      state.mine === state.peek && "fill-current",
                    )}
                  />
                  {state.votes[state.peek]}
                </button>
                <span className="flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 font-medium text-foreground text-sm tabular-nums">
                  <ArrowBigDown aria-hidden className="size-4" />
                  <span aria-hidden>{DOWNVOTES[state.peek]}</span>
                  <span className="sr-only">
                    {fill(copy.downvote, { count: DOWNVOTES[state.peek] })}
                  </span>
                </span>
              </section>
            </div>
          )}
        </aside>

        {/* The request dialog. */}
        {state.request.open && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 dark:bg-black/50">
            <div
              role="dialog"
              aria-label={fill(copy.dialogTitle, { project: copy.title })}
              className="flex w-[480px] max-w-[92%] flex-col gap-4 rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl"
            >
              <div>
                <h2 className="font-semibold text-base text-foreground">
                  {fill(copy.dialogTitle, { project: copy.title })}
                </h2>
                <p className="mt-1 text-muted-foreground text-xs">
                  {copy.note}
                </p>
              </div>
              <label className="flex flex-col gap-1.5 font-medium text-sm">
                {copy.titleLabel}
                <input
                  data-demo="pb-request-title"
                  type="text"
                  value={state.request.title}
                  placeholder={copy.titlePlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) =>
                    dispatch({ type: "typeRequest", value: event.target.value })
                  }
                  className="h-9 rounded-lg border border-input bg-background px-3 font-normal text-foreground text-sm outline-none placeholder:text-muted-foreground focus:border-ring dark:bg-input/32"
                />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="font-medium text-sm">{copy.detailsLabel}</span>
                <span className="block min-h-20 rounded-lg border border-input px-3 py-2 text-muted-foreground text-sm">
                  {copy.detailsPlaceholder}
                </span>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => dispatch({ type: "closeRequest" })}
                  className="h-8 cursor-pointer rounded-md px-3 text-muted-foreground text-xs hover:bg-accent"
                >
                  {copy.cancel}
                </button>
                <button
                  type="button"
                  data-demo="pb-request-send"
                  onClick={() => dispatch({ type: "sendRequest" })}
                  className="h-8 cursor-pointer rounded-md bg-primary px-3 font-medium text-primary-foreground text-xs"
                >
                  {copy.send}
                </button>
              </div>
            </div>
          </div>
        )}

        <NoticeToast
          open={state.toast}
          action={state.sent > 0 ? copy.myRequests : undefined}
        >
          {copy.sent}
        </NoticeToast>
      </main>

      <footer className="flex h-9 shrink-0 items-center justify-between border-border border-t px-4 text-muted-foreground text-xs">
        <span>{copy.poweredBy}</span>
      </footer>
    </ReplicaShell>
  );
}

/** The public board demo. */
export function PublicBoardDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createPublicBoardScene(copy.demo), [copy.demo]);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.publicBoard.caption}
      description={copy.scenes.publicBoard.description}
      size={{ width: 1280, height: 720 }}
      compactSize={{ width: 640, height: 820 }}
      className={className}
    />
  );
}
