"use client";

import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  FileSpreadsheet,
  FileText,
  Globe,
  LoaderCircle,
  Upload,
  X,
} from "lucide-react";
import { Fragment, useEffect, useMemo } from "react";
import { useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import { ProjectTile, ReplicaShell, StatusIcon, TopBar } from "../../replica";
import { SettingsFrame } from "../../replica/settings-frame";
import {
  COLUMNS,
  initialJiraState,
  JIRA_STATUSES,
  type JiraAction,
  type JiraState,
  type JiraStep,
  jiraReducer,
} from "./state";

/** Jira import: drop the CSV, map Code Review to In review, import. */
export function createJiraScene(): DemoScene<JiraState, JiraAction> {
  return {
    id: "jira",
    initialState: initialJiraState,
    reducer: jiraReducer,
    script: [
      step.wait(700),
      step.drag("jira-file", "jira-drop", { type: "drop" }),
      step.wait(800),
      step.click("jira-next", { type: "next" }),
      step.wait(700),
      step.click("jira-select-review", { type: "pick", id: "review" }),
      step.wait(400),
      step.click("jira-option-inReview", {
        type: "map",
        id: "review",
        column: "inReview",
      }),
      step.wait(500),
      step.click("jira-import", { type: "import" }),
      step.wait(1400),
      step.set({ type: "finish" }),
      step.wait(3200),
    ],
    render: (props) => <JiraView {...props} />,
  };
}

const STEP_ORDER: JiraStep[] = ["upload", "map", "importing"];

function JiraView({
  state,
  dispatch,
  interactive,
  compact,
}: SceneRenderProps<JiraState, JiraAction>) {
  const demo = useLandingCopy().demo;
  const copy = demo.jira;
  const reached = (index: number) =>
    state.step === "done" || STEP_ORDER.indexOf(state.step) >= index;

  // After the visitor takes over, an import finishes on its own.
  useEffect(() => {
    if (!interactive || state.step !== "importing") return;
    const timer = setTimeout(() => dispatch({ type: "finish" }), 1200);
    return () => clearTimeout(timer);
  }, [interactive, state.step, dispatch]);

  const steps = [copy.steps.upload, copy.steps.map, copy.steps.import];

  return (
    <ReplicaShell>
      <TopBar
        compact
        place={
          <>
            <ProjectTile icon={Globe} seed="web" className="size-5" />
            <span className="truncate">{demo.projects.website}</span>
          </>
        }
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* The settings page behind the dialog. */}
        <div aria-hidden className="opacity-60">
          <SettingsFrame title={copy.title} description={copy.source}>
            <div className="h-24 rounded-lg border border-border bg-card" />
          </SettingsFrame>
        </div>
        <div className="absolute inset-0 bg-black/30 dark:bg-black/50" />

        {/* The export on the visitor's desktop, waiting to be dropped. */}
        {state.step === "upload" && !state.file && (
          <div
            data-demo="jira-file"
            data-demo-cursor="grab"
            className="absolute bottom-5 left-5 z-10 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-lg"
          >
            <FileSpreadsheet aria-hidden className="size-5 text-success" />
            <span className="font-medium text-[13px] text-foreground">
              {copy.fileName}
            </span>
          </div>
        )}

        <div
          role="dialog"
          aria-label={copy.title}
          className={cn(
            "absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl",
            compact ? "w-[440px]" : "w-[540px]",
          )}
        >
          <div className="flex items-start justify-between gap-3 px-5 pt-4">
            <div>
              <h2 className="font-semibold text-base text-foreground">
                {copy.title}
              </h2>
              <p className="text-muted-foreground text-xs">{copy.source}</p>
            </div>
            <X aria-hidden className="size-4 text-muted-foreground" />
          </div>

          <ol className="flex items-center gap-1.5 px-5 pt-3 text-xs">
            {steps.map((label, index) => (
              <Fragment key={label}>
                {index > 0 && (
                  <ChevronRight
                    aria-hidden
                    className="size-3 text-muted-foreground"
                  />
                )}
                <li
                  className={cn(
                    "rounded-full px-2 py-0.5 font-medium",
                    reached(index)
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {label}
                </li>
              </Fragment>
            ))}
          </ol>

          <div className="min-h-[244px] px-5 py-4 text-sm">
            {state.step === "upload" && (
              <div className="space-y-3">
                <div
                  data-demo="jira-drop"
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center",
                    state.file
                      ? "border-border bg-muted/30"
                      : "border-input bg-muted/40",
                  )}
                >
                  <Upload
                    aria-hidden
                    className="size-5 text-muted-foreground"
                  />
                  <p className="text-muted-foreground text-xs">
                    {copy.dropHint}
                  </p>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "drop" })}
                    className="h-7 cursor-pointer rounded-md border border-input bg-background px-2.5 font-medium text-foreground text-xs hover:bg-accent dark:bg-input/32"
                  >
                    {copy.selectFile}
                  </button>
                </div>
                {state.file ? (
                  <div className="space-y-1 rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2">
                      <FileText
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {copy.fileName}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {copy.issueCount}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {copy.contents}
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs">{copy.limits}</p>
                )}
              </div>
            )}

            {(state.step === "map" || state.step === "importing") && (
              <section
                className={cn(
                  "space-y-2 transition-opacity",
                  state.step === "importing" && "opacity-60",
                )}
              >
                <h3 className="font-medium text-sm">{copy.statusesTitle}</h3>
                <div className="rounded-lg border border-border">
                  <div className="grid grid-cols-[1fr_auto] border-border border-b px-3 py-1.5 text-muted-foreground text-xs">
                    <span>{copy.jiraStatus}</span>
                    <span className="w-40">{copy.column}</span>
                  </div>
                  {JIRA_STATUSES.map((id) => {
                    const column = state.mapping[id];
                    return (
                      <div
                        key={id}
                        className="grid grid-cols-[1fr_auto] items-center border-border/60 border-b px-3 py-1.5 last:border-b-0"
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-medium">
                            {copy.statuses[id].name}
                          </span>
                          <span className="ms-2 text-muted-foreground text-xs">
                            {copy.statuses[id].meta}
                          </span>
                        </span>
                        <div className="relative w-40">
                          <button
                            type="button"
                            data-demo={`jira-select-${id}`}
                            aria-expanded={state.picking === id}
                            onClick={() => dispatch({ type: "pick", id })}
                            className={cn(
                              "flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2 text-left text-xs dark:bg-input/32",
                              state.picking === id
                                ? "border-ring ring-2 ring-ring/20"
                                : "border-input",
                            )}
                          >
                            <StatusIcon
                              status={column}
                              colored
                              className="size-3.5"
                            />
                            <span className="flex-1 truncate">
                              {demo.statuses[column]}
                            </span>
                            <ChevronDown
                              aria-hidden
                              className="size-3.5 text-muted-foreground"
                            />
                          </button>
                          {state.picking === id && (
                            <div
                              role="listbox"
                              className="absolute top-full right-0 z-20 mt-1 w-40 rounded-lg border border-border bg-popover p-1 shadow-lg"
                            >
                              {COLUMNS.map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  role="option"
                                  aria-selected={option === column}
                                  data-demo={`jira-option-${option}`}
                                  onClick={() =>
                                    dispatch({
                                      type: "map",
                                      id,
                                      column: option,
                                    })
                                  }
                                  className={cn(
                                    "flex w-full cursor-pointer items-center gap-1.5 rounded-[5px] px-2 py-1.5 text-left text-xs hover:bg-accent",
                                    option === column && "bg-accent/60",
                                  )}
                                >
                                  <StatusIcon
                                    status={option}
                                    colored
                                    className="size-3.5"
                                  />
                                  {demo.statuses[option]}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {state.step === "done" && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CircleCheck aria-hidden className="size-8 text-success" />
                <p
                  data-demo="jira-result"
                  className="font-semibold text-foreground text-lg"
                >
                  {copy.result}
                </p>
                <p className="text-muted-foreground text-xs">{copy.extras}</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-border border-t px-5 py-3">
            {state.step === "upload" && (
              <>
                <span className="h-8 rounded-md px-3 text-xs leading-8 text-muted-foreground">
                  {copy.cancel}
                </span>
                <button
                  type="button"
                  data-demo="jira-next"
                  disabled={!state.file}
                  onClick={() => dispatch({ type: "next" })}
                  className="h-8 cursor-pointer rounded-md bg-primary px-3 font-medium text-primary-foreground text-xs disabled:opacity-50"
                >
                  {copy.next}
                </button>
              </>
            )}
            {(state.step === "map" || state.step === "importing") && (
              <>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "back" })}
                  className="h-8 cursor-pointer rounded-md px-3 text-muted-foreground text-xs hover:bg-accent"
                >
                  {copy.back}
                </button>
                <button
                  type="button"
                  data-demo="jira-import"
                  onClick={() => dispatch({ type: "import" })}
                  className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 font-medium text-primary-foreground text-xs"
                >
                  {state.step === "importing" && (
                    <LoaderCircle
                      aria-hidden
                      className="size-3.5 motion-safe:animate-spin"
                    />
                  )}
                  {state.step === "importing"
                    ? copy.importing
                    : copy.importAction}
                </button>
              </>
            )}
            {state.step === "done" && (
              <button
                type="button"
                onClick={() => dispatch({ type: "reset" })}
                className="h-8 cursor-pointer rounded-md bg-primary px-3 font-medium text-primary-foreground text-xs"
              >
                {copy.done}
              </button>
            )}
          </div>
        </div>
      </div>
    </ReplicaShell>
  );
}

/** The Jira import demo. */
export function JiraImportDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createJiraScene(), []);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.jira.caption}
      description={copy.scenes.jira.description}
      size={{ width: 760, height: 560 }}
      compactSize={{ width: 480, height: 600 }}
      compactBelow={420}
      className={className}
    />
  );
}
