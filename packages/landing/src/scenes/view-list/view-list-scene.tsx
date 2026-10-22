"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowDownToLine,
  CalendarDays,
  ChevronRight,
  Menu,
  PanelsTopLeft,
  Plus,
  Rows3,
  X,
} from "lucide-react";
import { useMemo } from "react";
import { fill, useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import {
  AvatarStack,
  DueChip,
  LabelChip,
  LayoutToggle,
  LIST_GROUP_HEADER,
  ListGroupCount,
  listGroupStyle,
  PriorityIcon,
  ReplicaCheckbox,
  StatusIcon,
  type StatusId,
} from "../../replica";
import {
  type Demo,
  dueTone,
  formatDay,
  taskKeyOf,
  VIEW_STAGE_COMPACT,
  VIEW_STAGE_SIZE,
  type ViewTask,
  viewTasks,
  WORKFLOW,
} from "../views-shared/data";
import { ViewFrame } from "../views-shared/frame";
import {
  type ListViewAction,
  type ListViewState,
  listViewReducer,
} from "./state";

/**
 * The list layout grouped by status: Done folds away, two tasks in
 * progress are ticked (the bulk toolbar appears), and Done opens again.
 */
export function createListViewScene(
  demo: Demo,
): DemoScene<ListViewState, ListViewAction> {
  return {
    id: "viewList",
    initialState: { tasks: viewTasks(demo), collapsed: [], selected: [] },
    reducer: listViewReducer,
    script: [
      step.wait(600),
      step.click("group-done", { type: "toggleGroup", status: "done" }),
      step.wait(500),
      step.click("select-tokens", { type: "toggleSelect", id: "tokens" }),
      step.wait(250),
      step.click("select-latency", { type: "toggleSelect", id: "latency" }),
      step.wait(900),
      step.move("bulk-toolbar", { anchor: { x: 0.3 } }),
      step.wait(700),
      step.click("group-done", { type: "toggleGroup", status: "done" }),
      step.wait(2000),
    ],
    render: (props) => <ListView {...props} />,
  };
}

function ListView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<ListViewState, ListViewAction>) {
  const demo = useLandingCopy().demo;
  const { views, viewList } = demo;
  const count = state.selected.length;
  return (
    <ViewFrame
      view="board"
      compact={compact}
      taskCount={state.tasks.length}
      toolbar={
        <LayoutToggle
          label={views.layout.label}
          value="list"
          options={[
            { value: "board", label: views.layout.board, icon: PanelsTopLeft },
            { value: "list", label: views.layout.list, icon: Rows3 },
          ]}
        />
      }
    >
      <div className="h-full w-full overflow-hidden bg-background">
        {WORKFLOW.map((status) => (
          <ListGroup
            key={status}
            status={status}
            tasks={state.tasks.filter((task) => task.status === status)}
            expanded={!state.collapsed.includes(status)}
            selected={state.selected}
            compact={compact}
            onToggle={() => dispatch({ type: "toggleGroup", status })}
            onSelect={(id) => dispatch({ type: "toggleSelect", id })}
          />
        ))}
      </div>
      {count > 0 && (
        <div
          data-demo="bulk-toolbar"
          className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border/80 bg-background px-1.5 py-1 shadow-lg/8 transition-[translate,opacity] duration-200 ease-out starting:translate-y-3 starting:opacity-0"
        >
          <span className="whitespace-nowrap px-1.5 font-medium text-foreground text-sm">
            {fill(viewList.selected, { number: count })}
          </span>
          <Separator />
          {!compact && (
            <>
              <ToolbarButton icon={ArrowDownToLine}>
                {viewList.moveToBacklog}
              </ToolbarButton>
              <Separator />
              <ToolbarButton icon={CalendarDays}>
                {viewList.setDueDate}
              </ToolbarButton>
              <Separator />
            </>
          )}
          <ToolbarButton icon={Menu}>{viewList.actions}</ToolbarButton>
          <Separator />
          <button
            type="button"
            aria-label={viewList.clearSelection}
            onClick={() => dispatch({ type: "clearSelection" })}
            className="flex h-7 cursor-pointer items-center rounded-md px-2 text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}
    </ViewFrame>
  );
}

function Separator() {
  return <span aria-hidden className="my-1 h-5 w-px bg-border" />;
}

function ToolbarButton({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: string;
}) {
  return (
    <span className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2 font-medium text-foreground text-sm">
      <Icon aria-hidden className="size-4" />
      {children}
    </span>
  );
}

function ListGroup({
  status,
  tasks,
  expanded,
  selected,
  compact,
  onToggle,
  onSelect,
}: {
  status: StatusId;
  tasks: ViewTask[];
  expanded: boolean;
  selected: readonly string[];
  compact: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
}) {
  const demo = useLandingCopy().demo;
  return (
    <section
      aria-label={demo.statuses[status]}
      className="border-border/50 border-b"
    >
      <div
        className={cn(LIST_GROUP_HEADER, "justify-between")}
        style={listGroupStyle(status)}
      >
        <button
          type="button"
          data-demo={`group-${status}`}
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded font-medium text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
          <StatusIcon status={status} colored className="size-3.5" />
          <span className="truncate">{demo.statuses[status]}</span>
          <ListGroupCount count={tasks.length} />
        </button>
        <span className="flex size-6 items-center justify-center rounded text-muted-foreground">
          <Plus aria-hidden className="size-3.5" />
        </span>
      </div>
      {expanded && (
        <div className="bg-card transition-[translate,opacity] duration-150 ease-out starting:-translate-y-1 starting:opacity-0">
          {tasks.map((task) => (
            <ListRow
              key={task.id}
              task={task}
              selected={selected.includes(task.id)}
              compact={compact}
              onSelect={() => onSelect(task.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ListRow({
  task,
  selected,
  compact,
  onSelect,
}: {
  task: ViewTask;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
}) {
  const demo = useLandingCopy().demo;
  const key = taskKeyOf(demo, task);
  return (
    <div
      data-demo={`row-${task.id}`}
      data-selected={selected || undefined}
      className={cn(
        "relative border-border/50 border-b transition-colors duration-150",
        selected &&
          "bg-accent/60 before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-0.5 before:bg-primary",
      )}
    >
      <div
        className={cn(
          "flex min-h-9 items-center gap-2 px-3 py-0.5",
          selected && "bg-accent/45",
        )}
      >
        <ReplicaCheckbox
          data-demo={`select-${task.id}`}
          checked={selected}
          label={fill(demo.viewList.select, { key })}
          onChange={onSelect}
          className={selected ? undefined : "opacity-70"}
        />
        <span className="flex size-5 shrink-0 items-center justify-center">
          <PriorityIcon priority={task.priority} className="size-3.5" />
        </span>
        <span className="w-14 shrink-0 truncate font-mono text-muted-foreground text-xs">
          {key}
        </span>
        <StatusIcon status={task.status} colored className="size-3.5" />
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span
            className={cn(
              "truncate text-[13px]",
              task.status === "done"
                ? "text-muted-foreground"
                : "text-foreground",
            )}
          >
            {task.title}
          </span>
          {!compact && task.labels.length > 0 && (
            <span className="flex shrink-0 items-center gap-1">
              {task.labels.map((label) => (
                <LabelChip
                  key={label.name}
                  name={label.name}
                  color={label.color}
                />
              ))}
            </span>
          )}
        </span>
        <DueChip label={formatDay(demo, task.end)} tone={dueTone(task)} />
        <AvatarStack names={task.assignees} max={2} size="sm" />
      </div>
    </div>
  );
}

/** The list scene, ready to drop into a page. */
export function ListViewDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createListViewScene(copy.demo), [copy.demo]);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.viewList.caption}
      description={copy.scenes.viewList.description}
      size={VIEW_STAGE_SIZE}
      compactSize={VIEW_STAGE_COMPACT}
      className={className}
    />
  );
}
