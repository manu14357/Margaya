"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CornerDownLeft,
  House,
  Inbox,
  IterationCw,
  Keyboard,
  Moon,
  Plus,
  Search,
  StickyNote,
  UserRoundCheck,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { type LandingCopy, useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import {
  AvatarStack,
  Board,
  BoardColumn,
  Kbd,
  LabelChip,
  PriorityIcon,
  PropertyPopover,
  PropertyValue,
  ReplicaToast,
  type SheetProperty,
  StatusIcon,
  type StatusId,
  TaskCard,
  TaskSheet,
} from "../../replica";
import {
  type Demo,
  dueTone,
  formatDay,
  taskKeyOf,
  type ViewTask,
  viewTasks,
} from "../views-shared/data";
import { ViewFrame } from "../views-shared/frame";
import {
  type PaletteAction,
  type PaletteGroupId,
  type PaletteItem,
  type PaletteState,
  paletteGroups,
  paletteReducer,
  parseQuery,
  STATUS_ORDER,
} from "./state";

/** The task open in the sheet. */
const OPEN_TASK = "search";

/**
 * Ctrl K with a task open: "> status" narrows the bar to "Change status…",
 * Enter opens the picker, ↓ and Enter set In progress, a toast confirms.
 */
export function createPaletteScene(
  demo: Demo,
): DemoScene<PaletteState, PaletteAction> {
  return {
    id: "palette",
    initialState: {
      phase: "closed",
      query: "",
      pickerIndex: 0,
      status: "todo",
      toast: false,
    },
    reducer: paletteReducer,
    script: [
      step.wait(900),
      step.key("Ctrl+K", { type: "open" }),
      step.wait(350),
      step.type(
        "palette-input",
        demo.palette.typed,
        (value) => ({ type: "input", value }),
        11,
      ),
      step.wait(700),
      step.key("Enter", { type: "run" }),
      step.wait(450),
      step.key("↓", { type: "move", delta: 1 }),
      step.wait(200),
      step.key("Enter", { type: "apply" }),
      step.wait(2600),
    ],
    render: (props) => <PaletteView {...props} />,
  };
}

function paletteItems(
  palette: LandingCopy["demo"]["palette"],
): Record<PaletteGroupId, PaletteItem[]> {
  const { items } = palette;
  return {
    thisTask: [
      { id: "status", label: items.status, shortcut: "S" },
      { id: "priority", label: items.priority, shortcut: "P" },
      { id: "assignees", label: items.assignees, shortcut: "A" },
      { id: "labels", label: items.labels, shortcut: "L" },
    ],
    suggestions: [
      { id: "home", label: items.home },
      { id: "inbox", label: items.inbox },
      { id: "myWork", label: items.myWork },
    ],
    commands: [
      { id: "createTask", label: items.createTask, shortcut: "T C" },
      { id: "newSticky", label: items.newSticky },
      { id: "darkTheme", label: items.darkTheme },
      { id: "shortcuts", label: items.shortcuts, shortcut: "?" },
    ],
  };
}

const ITEM_ICONS: Partial<Record<string, LucideIcon>> = {
  home: House,
  inbox: Inbox,
  myWork: UserRoundCheck,
  createTask: Plus,
  newSticky: StickyNote,
  darkTheme: Moon,
  shortcuts: Keyboard,
};

const BOARD_COLUMNS: StatusId[] = ["todo", "inProgress", "inReview"];

function PaletteView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<PaletteState, PaletteAction>) {
  const demo = useLandingCopy().demo;
  const tasks = useMemo(
    () =>
      viewTasks(demo).map((task) =>
        task.id === OPEN_TASK ? { ...task, status: state.status } : task,
      ),
    [demo, state.status],
  );
  const open = tasks.find((task) => task.id === OPEN_TASK) as ViewTask;
  const columns = compact ? BOARD_COLUMNS.slice(0, 1) : BOARD_COLUMNS;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Ctrl K anywhere in the replica, as in the app.
    <div
      className="h-full w-full"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "k"
        ) {
          event.preventDefault();
          dispatch({ type: "open" });
        }
      }}
    >
      <ViewFrame view="board" compact={compact} taskCount={tasks.length}>
        <Board>
          {columns.map((status) => {
            const cards = tasks.filter((task) => task.status === status);
            return (
              <BoardColumn
                key={status}
                status={status}
                title={demo.statuses[status]}
                count={cards.length}
              >
                {cards.map((task) => (
                  <TaskCard
                    key={task.id}
                    taskKey={taskKeyOf(demo, task)}
                    title={task.title}
                    labels={task.labels}
                    priority={task.priority}
                    assignees={task.assignees}
                    due={{
                      label: formatDay(demo, task.end),
                      tone: dueTone(task),
                    }}
                    selected={task.id === OPEN_TASK}
                  />
                ))}
              </BoardColumn>
            );
          })}
        </Board>
        <TaskSheet
          open
          taskKey={taskKeyOf(demo, open)}
          status={{ id: open.status, label: demo.statuses[open.status] }}
          title={open.title}
          description={demo.palette.taskDescription}
          propertiesLabel={demo.sheet.properties}
          closeLabel={demo.sheet.close}
          properties={sheetProperties(open, demo, state, dispatch)}
          className={compact ? "w-full" : undefined}
        />
        {state.toast && <ReplicaToast>{demo.palette.toast}</ReplicaToast>}
      </ViewFrame>
      {state.phase === "palette" && (
        <CommandBar
          query={state.query}
          onInput={(value) => dispatch({ type: "input", value })}
          onRun={() => dispatch({ type: "run" })}
          onClose={() => dispatch({ type: "close" })}
        />
      )}
    </div>
  );
}

function sheetProperties(
  task: ViewTask,
  demo: Demo,
  state: PaletteState,
  dispatch: (action: PaletteAction) => void,
): SheetProperty[] {
  const { sheet } = demo;
  return [
    {
      id: "status",
      label: sheet.status,
      value: (
        <span className="relative">
          <PropertyValue
            data-demo="status-value"
            icon={
              <StatusIcon status={task.status} colored className="size-3.5" />
            }
          >
            {demo.statuses[task.status]}
          </PropertyValue>
          {state.phase === "picker" && (
            <PropertyPopover
              data-demo="status-picker"
              className="absolute top-8 left-0"
              searchPlaceholder={demo.palette.statusPicker}
              highlighted={STATUS_ORDER[state.pickerIndex]}
              onSelect={(id) =>
                dispatch({ type: "apply", status: id as StatusId })
              }
              options={STATUS_ORDER.map((status) => ({
                id: status,
                label: demo.statuses[status],
                icon: (
                  <StatusIcon status={status} colored className="size-3.5" />
                ),
                selected: status === task.status,
              }))}
            />
          )}
        </span>
      ),
    },
    {
      id: "priority",
      label: sheet.priority,
      value: (
        <PropertyValue icon={<PriorityIcon priority={task.priority} />}>
          {demo.priorities[task.priority]}
        </PropertyValue>
      ),
    },
    {
      id: "assignees",
      label: sheet.assignees,
      value: (
        <PropertyValue
          icon={<AvatarStack names={task.assignees} max={3} size="xs" />}
        >
          {task.assignees.join(", ")}
        </PropertyValue>
      ),
    },
    {
      id: "labels",
      label: sheet.labels,
      value: (
        <span className="flex flex-wrap gap-1 ps-1.5">
          {task.labels.map((label) => (
            <LabelChip key={label.name} name={label.name} color={label.color} />
          ))}
        </span>
      ),
    },
    {
      id: "dueDate",
      label: sheet.dueDate,
      value: (
        <PropertyValue
          icon={
            <CalendarDays
              aria-hidden
              className="size-3.5 text-muted-foreground"
            />
          }
        >
          {formatDay(demo, task.end)}
        </PropertyValue>
      ),
    },
    {
      id: "cycle",
      label: sheet.cycle,
      value: (
        <PropertyValue
          icon={
            <IterationCw
              aria-hidden
              className="size-3.5 text-muted-foreground"
            />
          }
        >
          {demo.views.cycle}
        </PropertyValue>
      ),
    },
  ];
}

/** The Ctrl K bar: input, grouped rows, then the key and prefix hints. */
function CommandBar({
  query,
  onInput,
  onRun,
  onClose,
}: {
  query: string;
  onInput: (value: string) => void;
  onRun: () => void;
  onClose: () => void;
}) {
  const { palette } = useLandingCopy().demo;
  const groups = paletteGroups(query, paletteItems(palette));
  const highlighted = groups[0]?.items[0]?.id;
  const actions = parseQuery(query).mode === "actions";
  return (
    <div className="absolute inset-0 z-30">
      <div aria-hidden className="absolute inset-0 bg-black/32" />
      <div
        role="dialog"
        aria-label={palette.placeholder}
        className="absolute top-[11%] left-1/2 flex w-[576px] max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-lg/5 transition-[scale,opacity] duration-200 ease-out starting:scale-98 starting:opacity-0"
      >
        <div className="flex h-12 items-center gap-2 bg-muted/72 px-4">
          <Search
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          <input
            data-demo="palette-input"
            type="text"
            value={query}
            aria-label={palette.placeholder}
            placeholder={
              actions ? palette.placeholderActions : palette.placeholder
            }
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && highlighted === "status") {
                event.preventDefault();
                onRun();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="min-h-24 border-border border-t bg-popover p-2">
          {groups.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">
              {palette.empty}
            </p>
          ) : (
            groups.map((group, index) => (
              <div key={group.id}>
                {index > 0 && <div className="my-2 h-px bg-border" />}
                <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
                  {palette.groups[group.id]}
                </div>
                {group.items.map((item) => (
                  <PaletteRow
                    key={item.id}
                    item={item}
                    active={item.id === highlighted}
                    onClick={item.id === "status" ? onRun : undefined}
                  />
                ))}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-border border-t bg-muted/72 px-5 py-3 text-muted-foreground text-xs">
          <span className="flex items-center gap-4">
            <span className="flex items-center gap-2">
              <span className="flex gap-1">
                <Kbd>
                  <ArrowUp aria-hidden className="size-3" />
                </Kbd>
                <Kbd>
                  <ArrowDown aria-hidden className="size-3" />
                </Kbd>
              </span>
              {palette.footer.navigate}
            </span>
            <span className="flex items-center gap-2">
              <Kbd>
                <CornerDownLeft aria-hidden className="size-3" />
              </Kbd>
              {palette.footer.open}
            </span>
          </span>
          <span className="hidden items-center gap-3 sm:flex">
            <PrefixHint prefix=">">{palette.prefixes.actions}</PrefixHint>
            <PrefixHint prefix="#">{palette.prefixes.tasks}</PrefixHint>
            <PrefixHint prefix="@">{palette.prefixes.people}</PrefixHint>
            <PrefixHint prefix="/">{palette.prefixes.places}</PrefixHint>
          </span>
        </div>
      </div>
    </div>
  );
}

function PaletteRow({
  item,
  active,
  onClick,
}: {
  item: PaletteItem;
  active: boolean;
  onClick?: () => void;
}) {
  const Icon = ITEM_ICONS[item.id];
  return (
    <button
      type="button"
      data-demo={`palette-item-${item.id}`}
      onClick={onClick}
      className={cn(
        "flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
        active && "bg-accent",
      )}
    >
      {Icon && <Icon aria-hidden className="size-4 opacity-72" />}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.shortcut && (
        <kbd className="ms-auto font-medium font-sans text-muted-foreground/72 text-xs tracking-widest">
          {item.shortcut}
        </kbd>
      )}
    </button>
  );
}

function PrefixHint({
  prefix,
  children,
}: {
  prefix: string;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1">
      <Kbd className="font-mono">{prefix}</Kbd>
      {children}
    </span>
  );
}

/** The command-bar scene, ready to drop into a page. */
export function CommandPaletteDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createPaletteScene(copy.demo), [copy.demo]);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.palette.caption}
      description={copy.scenes.palette.description}
      size={{ width: 1280, height: 760 }}
      compactSize={{ width: 640, height: 760 }}
      className={className}
    />
  );
}
