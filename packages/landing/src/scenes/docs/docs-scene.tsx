"use client";

import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  FileText,
  Globe,
  Info,
  Link2,
  Lock,
  PanelRight,
  Plus,
  Star,
} from "lucide-react";
import { useMemo } from "react";
import { fill, type LandingCopy, useLandingCopy } from "../../copy";
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
  ContextPanel,
  IconRail,
  PanelRow,
  PanelSection,
  ProjectTile,
  ReplicaShell,
  TopBar,
} from "../../replica";
import {
  type DocsAction,
  type DocsState,
  docsReducer,
  filterSlash,
  type SlashCommandId,
  type SlashGroupId,
} from "./state";

type Demo = LandingCopy["demo"];

/** Which part of the page story a stage tells. `all` is the home page's. */
export type DocsVariant = "all" | "together" | "slash" | "tasks";

function initialState(demo: Demo, variant: DocsVariant): DocsState {
  const written = variant === "slash" || variant === "tasks";
  return {
    mine: written ? demo.docs.mine : "",
    collab: written ? demo.docs.collab : "",
    focus: null,
    collabActive: false,
    slash: { open: false, query: "" },
    callout: variant === "tasks" ? demo.docs.callout : null,
    chip: false,
    preview: false,
  };
}

function togetherSteps(demo: Demo): Step<DocsAction>[] {
  return [
    step.parallel<DocsAction>(
      [
        step.click("caret-mine", { type: "focus", at: "mine" }),
        step.type(
          "caret-mine",
          demo.docs.mine,
          (value) => ({ type: "typeMine", value }),
          20,
        ),
      ],
      [
        step.wait(450),
        step.click(
          "caret-collab",
          { type: "collabFocus" },
          { cursor: "collab" },
        ),
        step.type(
          "caret-collab",
          demo.docs.collab,
          (value) => ({ type: "typeCollab", value }),
          17,
        ),
      ],
    ),
    step.wait(700),
  ];
}

function slashSteps(demo: Demo): Step<DocsAction>[] {
  return [
    step.click("line-slash", { type: "focus", at: "slash" }),
    step.type(
      "line-slash",
      `/${demo.docs.slashQuery}`,
      (value) => ({ type: "slash", value }),
      7,
    ),
    step.wait(650),
    step.key("Enter", { type: "pickSlash", command: "callout" }),
    step.wait(250),
    step.type(
      "callout-text",
      demo.docs.callout,
      (value) => ({ type: "typeCallout", value }),
      24,
    ),
    step.wait(700),
  ];
}

function taskSteps(): Step<DocsAction>[] {
  return [
    step.click("caret-depends", { type: "focus", at: "depends" }),
    step.wait(250),
    step.key("Ctrl+V", { type: "paste" }),
    step.wait(450),
    step.move("task-chip", { anchor: { x: 0.35 } }),
    step.set({ type: "preview", open: true }),
    step.wait(2600),
  ];
}

/**
 * The page editor: two people co-editing, a slash menu inserting an info
 * callout, and a pasted task link becoming a chip. `variant` picks the part
 * of the story (the feature page shows each on its own).
 */
export function createDocsScene(
  demo: Demo,
  variant: DocsVariant = "all",
): DemoScene<DocsState, DocsAction> {
  const script: Step<DocsAction>[] = [step.wait(500)];
  if (variant === "all" || variant === "together") {
    script.push(...togetherSteps(demo));
  }
  if (variant === "all" || variant === "slash") {
    script.push(...slashSteps(demo));
  }
  if (variant === "all" || variant === "tasks") script.push(...taskSteps());
  return {
    id: variant === "all" ? "docs" : `docs-${variant}`,
    initialState: initialState(demo, variant),
    reducer: docsReducer,
    script,
    render: (props) => <DocsView {...props} />,
  };
}

const GROUPS: SlashGroupId[] = ["text", "lists", "insert"];

const DOC_TOOLS = [
  ["lock", Lock],
  ["favorite", Star],
  ["link", Link2],
  ["panel", PanelRight],
  ["more", Ellipsis],
] as const;

function Caret({ visible, target }: { visible: boolean; target: string }) {
  return (
    <span
      data-demo={target}
      data-demo-cursor="text"
      aria-hidden
      className={cn(
        "relative -mx-px inline-block h-[1.15em] w-px align-text-bottom",
        visible ? "bg-foreground motion-safe:animate-pulse" : "bg-transparent",
      )}
    />
  );
}

function CollabCaret({ name, visible }: { name: string; visible: boolean }) {
  return (
    <span
      data-demo="caret-collab"
      data-demo-cursor="text"
      aria-hidden
      className={cn(
        "relative -mx-px inline-block h-[1.15em] w-0.5 align-text-bottom",
        visible ? "bg-info" : "bg-transparent",
      )}
    >
      {visible && (
        <span className="absolute -top-[1.35em] left-0 whitespace-nowrap rounded-sm rounded-bl-none bg-info px-1.5 font-medium text-[11px] text-white leading-4">
          {name}
        </span>
      )}
    </span>
  );
}

function SlashMenu({
  query,
  dispatch,
}: {
  query: string;
  dispatch: (action: DocsAction) => void;
}) {
  const { slashCommands, slashGroups, slashShortcuts, slashEmpty } =
    useLandingCopy().demo.docs;
  const shortcuts: Partial<Record<SlashCommandId, string>> = slashShortcuts;
  const shown = filterSlash(query, slashCommands);
  const selected = shown[0]?.id;
  return (
    <div
      data-demo="slash-menu"
      className="absolute top-full left-0 z-20 mt-1 w-64 rounded-lg border border-border/80 bg-popover p-1 text-popover-foreground shadow-xl"
    >
      {shown.length === 0 && (
        <p className="px-2 py-1.5 text-muted-foreground text-xs">
          {slashEmpty}
        </p>
      )}
      {GROUPS.map((group) => {
        const items = shown.filter((command) => command.group === group);
        if (items.length === 0) return null;
        return (
          <div
            key={group}
            className="mt-0.5 border-border/70 border-t pt-0.5 first:mt-0 first:border-t-0 first:pt-0"
          >
            <div className="px-1.5 pt-1 pb-1 font-semibold text-[10.5px] text-foreground/50 uppercase tracking-wide">
              {slashGroups[group]}
            </div>
            {items.map((command) => (
              <button
                key={command.id}
                type="button"
                data-demo={`slash-${command.id}`}
                onClick={() =>
                  dispatch({ type: "pickSlash", command: command.id })
                }
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-3 rounded-[5px] px-2 py-1.5 text-left text-[12.5px] text-foreground/90",
                  command.id === selected
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent",
                )}
              >
                <span className="truncate">{slashCommands[command.id]}</span>
                {shortcuts[command.id] && (
                  <span className="shrink-0 text-[10.5px] text-foreground/50">
                    {shortcuts[command.id]}
                  </span>
                )}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function TaskChip({
  open,
  dispatch,
}: {
  open: boolean;
  dispatch: (action: DocsAction) => void;
}) {
  const demo = useLandingCopy().demo;
  const { task } = demo.docs;
  return (
    <span className="relative inline-flex align-baseline">
      <button
        type="button"
        data-demo="task-chip"
        aria-expanded={open}
        onClick={() => dispatch({ type: "preview", open: !open })}
        className="inline-flex max-w-[26rem] -translate-y-px cursor-pointer items-center gap-1.5 rounded-[7px] border border-border/80 bg-accent/25 px-1.5 py-0.5 leading-[1.3] transition-colors hover:border-ring/50 hover:bg-accent/40"
      >
        <span className="shrink-0 font-medium text-[12px] text-foreground/65">
          {task.key}
        </span>
        <span className="truncate font-medium text-[13.5px] text-foreground">
          {task.title}
        </span>
      </button>
      <span
        aria-hidden={!open}
        className={cn(
          "absolute top-full left-0 z-20 mt-2 w-72 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg transition-[opacity,transform] duration-200",
          open
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-1 opacity-0",
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">
            {task.key}
          </span>
          <Avatar name={demo.people.priya.name} size="sm" />
        </span>
        <span className="mt-1 block font-medium text-[13px] text-foreground leading-5">
          {task.title}
        </span>
        <span className="mt-1.5 flex items-center gap-1.5 text-muted-foreground text-xs">
          <span>{demo.statuses.inProgress}</span>
          <span aria-hidden>·</span>
          <span>{demo.priorities.high}</span>
        </span>
      </span>
    </span>
  );
}

function PageTree() {
  const demo = useLandingCopy().demo;
  const { docs } = demo;
  const rows: {
    id: keyof typeof docs.tree;
    depth: number;
    expanded?: boolean;
  }[] = [
    { id: "launchPlan", depth: 0, expanded: true },
    { id: "pressKit", depth: 1 },
    { id: "runbook", depth: 1 },
    { id: "releaseNotes", depth: 0 },
    { id: "principles", depth: 0 },
  ];
  return (
    <ContextPanel title={docs.treeTitle}>
      <PanelSection
        label={
          <span className="flex w-full items-center justify-between">
            {demo.projects.website}
            <Plus aria-hidden className="size-3.5" />
          </span>
        }
      >
        {rows.map((row) => (
          <PanelRow
            key={row.id}
            active={row.id === "launchPlan"}
            label={docs.tree[row.id]}
            leading={
              <span
                className="flex shrink-0 items-center gap-1"
                style={{ paddingInlineStart: row.depth * 14 }}
              >
                {row.expanded ? (
                  <ChevronDown aria-hidden className="size-3 opacity-60" />
                ) : (
                  <ChevronRight
                    aria-hidden
                    className={cn(
                      "size-3 opacity-60",
                      row.depth > 0 && "invisible",
                    )}
                  />
                )}
                <FileText aria-hidden className="size-3.5 opacity-75" />
              </span>
            }
          />
        ))}
      </PanelSection>
    </ContextPanel>
  );
}

function Presence() {
  const demo = useLandingCopy().demo;
  const others = [demo.people.mira.name, demo.people.jonas.name];
  return (
    <div className="flex items-center gap-2">
      <ul
        aria-label={fill(demo.docs.presence, { names: others.join(", ") })}
        className="flex items-center -space-x-1 pe-0.5"
      >
        <li className="inline-flex">
          <Avatar
            name={others[0] ?? ""}
            size="md"
            className="ring-2 ring-info"
          />
        </li>
        <li className="inline-flex">
          <Avatar
            name={others[1] ?? ""}
            size="md"
            className="ring-2 ring-success"
          />
        </li>
      </ul>
      <span className="inline-flex h-5 items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 font-medium text-[11px] text-success-foreground">
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-success motion-safe:animate-pulse"
        />
        {demo.docs.live}
      </span>
      <span className="text-muted-foreground text-xs">{demo.docs.saved}</span>
    </div>
  );
}

function DocsView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<DocsState, DocsAction>) {
  const demo = useLandingCopy().demo;
  const { docs } = demo;
  const slashText = state.slash.open ? `/${state.slash.query}` : "";

  return (
    <ReplicaShell
      rail={
        compact ? undefined : (
          <IconRail
            active="pages"
            user={demo.people.adam.name}
            inboxCount={2}
          />
        )
      }
      panel={compact ? undefined : <PageTree />}
    >
      <TopBar
        compact={compact}
        place={
          <>
            <ProjectTile icon={Globe} seed="web" className="size-5" />
            <span className="truncate">{docs.title}</span>
          </>
        }
        actions={<Presence />}
      />
      {/* The document bar: page switcher, access, last edit, page tools. */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-border/80 border-b px-3 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-[13px] text-foreground">
          <FileText aria-hidden className="size-3.5 text-muted-foreground" />
          {docs.title}
          <ChevronDown aria-hidden className="size-3 text-muted-foreground" />
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Globe aria-hidden className="size-3.5" />
          {docs.access}
        </span>
        {!compact && (
          <span className="text-muted-foreground">{docs.edited}</span>
        )}
        <span className="ms-auto flex items-center gap-0.5 text-muted-foreground">
          {DOC_TOOLS.map(([id, Icon]) => (
            <span
              key={id}
              className="flex size-7 items-center justify-center rounded-md"
            >
              <Icon aria-hidden className="size-3.5" />
            </span>
          ))}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <article
          className={cn(
            "mx-auto w-full max-w-[680px] pb-16 text-[15px] text-foreground/90 leading-7",
            compact ? "px-6 pt-8" : "px-10 pt-10",
          )}
        >
          <p className="mb-2 text-muted-foreground text-xs">
            {demo.projects.website} /
          </p>
          <h1 className="mb-5 font-semibold text-[30px] text-foreground leading-tight">
            {docs.title}
          </h1>
          <p>
            {docs.introLead}{" "}
            <span className="whitespace-nowrap rounded-[5px] bg-primary/12 px-1 font-medium text-primary">
              @{demo.people.adam.name}
            </span>
            .
          </p>

          <h2 className="mt-6 mb-1 font-semibold text-[19px] text-foreground leading-8">
            {docs.ownersHeading}
          </h2>
          <p className="min-h-7">
            {state.mine}
            <Caret target="caret-mine" visible={state.focus === "mine"} />
          </p>
          <p className="min-h-7">
            {state.collab}
            <CollabCaret
              name={demo.people.mira.name}
              visible={state.collabActive}
            />
          </p>

          {state.callout !== null ? (
            <div
              data-callout="info"
              className="my-2.5 flex items-start gap-2.5 rounded-md border border-info/35 bg-info/10 px-3 py-2"
            >
              <Info
                aria-hidden
                className="mt-1.5 size-4 shrink-0 text-info-foreground"
              />
              <p
                data-demo="callout-text"
                data-demo-cursor="text"
                className="min-h-7 flex-1"
              >
                {state.callout}
                <Caret
                  target="caret-callout"
                  visible={state.focus === "callout"}
                />
              </p>
            </div>
          ) : (
            <div className="relative">
              <button
                type="button"
                data-demo="line-slash"
                data-demo-cursor="text"
                onClick={() => dispatch({ type: "slash", value: "/" })}
                className="block min-h-7 w-full cursor-text text-left"
              >
                {slashText}
                <Caret target="caret-slash" visible={state.focus === "slash"} />
              </button>
              {state.slash.open && (
                <SlashMenu query={state.slash.query} dispatch={dispatch} />
              )}
            </div>
          )}

          <h2 className="mt-6 mb-1 font-semibold text-[19px] text-foreground leading-8">
            {docs.dependsHeading}
          </h2>
          <p>
            {docs.dependsLead}{" "}
            {state.chip && (
              <TaskChip open={state.preview} dispatch={dispatch} />
            )}
            <Caret
              target="caret-depends"
              visible={state.focus === "depends" && !state.chip}
            />
            {state.chip && "."}
          </p>
        </article>
      </div>
    </ReplicaShell>
  );
}

const SIZES = {
  all: { width: 1280, height: 800 },
  part: { width: 1040, height: 680 },
};

function DocsStage({
  variant,
  className,
}: {
  variant: DocsVariant;
  className?: string;
}) {
  const copy = useLandingCopy();
  const scene = useMemo(
    () => createDocsScene(copy.demo, variant),
    [copy.demo, variant],
  );
  const scenes = copy.scenes;
  const text =
    variant === "together"
      ? scenes.docsTogether
      : variant === "slash"
        ? scenes.docsSlash
        : variant === "tasks"
          ? scenes.docsTasks
          : scenes.docs;
  return (
    <DemoStage
      scene={scene}
      caption={text.caption}
      description={text.description}
      size={variant === "all" ? SIZES.all : SIZES.part}
      compactSize={{ width: 640, height: 760 }}
      collaborator={
        variant === "all" || variant === "together"
          ? copy.demo.people.mira.name
          : undefined
      }
      className={className}
    />
  );
}

/** The whole page story, for the home page. */
export function DocsDemo({ className }: { className?: string }) {
  return <DocsStage variant="all" className={className} />;
}

/** Two people typing in the same page. */
export function DocsTogetherDemo({ className }: { className?: string }) {
  return <DocsStage variant="together" className={className} />;
}

/** The slash menu inserting a callout. */
export function DocsSlashDemo({ className }: { className?: string }) {
  return <DocsStage variant="slash" className={className} />;
}

/** A pasted task link becoming a chip. */
export function DocsTasksDemo({ className }: { className?: string }) {
  return <DocsStage variant="tasks" className={className} />;
}
