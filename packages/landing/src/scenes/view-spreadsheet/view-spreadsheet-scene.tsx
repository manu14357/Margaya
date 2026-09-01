"use client";

import { IterationCw } from "lucide-react";
import { type ReactNode, useMemo } from "react";
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
  type Priority,
  PriorityIcon,
  PropertyPopover,
  ReplicaCheckbox,
  StatusIcon,
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
} from "../views-shared/data";
import { ViewFrame } from "../views-shared/frame";
import {
  type SpreadsheetViewAction,
  type SpreadsheetViewState,
  spreadsheetViewReducer,
} from "./state";

const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low", "none"];

/** The spreadsheet layout: a priority cell is edited in place. */
export function createSpreadsheetViewScene(
  demo: Demo,
): DemoScene<SpreadsheetViewState, SpreadsheetViewAction> {
  return {
    id: "viewSpreadsheet",
    initialState: {
      tasks: viewTasks(demo),
      editing: null,
      edited: null,
      selected: [],
    },
    reducer: spreadsheetViewReducer,
    script: [
      step.wait(700),
      step.click("cell-priority-latency", { type: "open", id: "latency" }),
      step.wait(500),
      step.move("option-high"),
      step.wait(200),
      step.click("option-urgent", {
        type: "pick",
        id: "latency",
        priority: "urgent",
      }),
      step.wait(2400),
    ],
    render: (props) => <SpreadsheetView {...props} />,
  };
}

type Column = { id: string; label: string; width: number };

function SpreadsheetView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<SpreadsheetViewState, SpreadsheetViewAction>) {
  const demo = useLandingCopy().demo;
  const { columns } = demo.viewSpreadsheet;
  const first = compact ? 240 : 360;
  const cells: Column[] = [
    { id: "status", label: columns.status, width: 160 },
    { id: "priority", label: columns.priority, width: 120 },
    { id: "assignees", label: columns.assignees, width: 160 },
    { id: "labels", label: columns.labels, width: 200 },
    { id: "cycle", label: columns.cycle, width: 150 },
    { id: "dueDate", label: columns.dueDate, width: 120 },
  ];
  return (
    <ViewFrame
      view="spreadsheet"
      compact={compact}
      taskCount={state.tasks.length}
    >
      <div className="h-full w-full overflow-hidden bg-background">
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-20 h-8 border-border border-b bg-muted px-2 text-left align-middle font-medium text-muted-foreground text-xs"
                style={{ width: first, minWidth: first, maxWidth: first }}
              >
                <span className="ps-12">{demo.viewSpreadsheet.task}</span>
              </th>
              {cells.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className="h-8 border-border border-b border-l bg-muted px-2 text-left align-middle font-medium text-muted-foreground text-xs"
                  style={{ width: column.width, minWidth: column.width }}
                >
                  {column.label}
                </th>
              ))}
              <th className="border-border border-b bg-card" />
            </tr>
          </thead>
          <tbody>
            {state.tasks.map((task) => (
              <SheetRow
                key={task.id}
                task={task}
                first={first}
                columns={cells}
                editing={state.editing === task.id}
                edited={state.edited === task.id}
                selected={state.selected.includes(task.id)}
                dispatch={dispatch}
              />
            ))}
          </tbody>
        </table>
      </div>
    </ViewFrame>
  );
}

function SheetRow({
  task,
  first,
  columns,
  editing,
  edited,
  selected,
  dispatch,
}: {
  task: ViewTask;
  first: number;
  columns: Column[];
  editing: boolean;
  edited: boolean;
  selected: boolean;
  dispatch: (action: SpreadsheetViewAction) => void;
}) {
  const demo = useLandingCopy().demo;
  const key = taskKeyOf(demo, task);
  const cell = (id: string): ReactNode => {
    switch (id) {
      case "status":
        return (
          <Plain>
            <StatusIcon status={task.status} colored className="size-3.5" />
            <span className="truncate">{demo.statuses[task.status]}</span>
          </Plain>
        );
      case "priority":
        return (
          <>
            <button
              type="button"
              data-demo={`cell-priority-${task.id}`}
              aria-expanded={editing}
              onClick={() => dispatch({ type: "open", id: task.id })}
              className={cn(
                "flex h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 px-2 text-left text-sm outline-none transition-colors duration-500 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                editing && "bg-accent",
                edited && !editing && "bg-primary/10",
              )}
            >
              <PriorityIcon priority={task.priority} className="size-3.5" />
              <span className="truncate">{demo.priorities[task.priority]}</span>
            </button>
            {editing && (
              <PropertyPopover
                data-demo="priority-picker"
                className="absolute top-9 left-0"
                searchPlaceholder={demo.viewSpreadsheet.priorityPicker}
                highlighted={task.priority}
                options={PRIORITIES.map((priority) => ({
                  id: priority,
                  label: demo.priorities[priority],
                  icon: (
                    <PriorityIcon priority={priority} className="size-3.5" />
                  ),
                  selected: priority === task.priority,
                }))}
                onSelect={(id) =>
                  dispatch({
                    type: "pick",
                    id: task.id,
                    priority: id as Priority,
                  })
                }
              />
            )}
          </>
        );
      case "assignees":
        return (
          <Plain>
            <AvatarStack names={task.assignees} max={2} size="xs" />
            <span className="truncate">
              {task.assignees.length === 1
                ? task.assignees[0]
                : task.assignees.map((name) => name.split(" ")[0]).join(", ")}
            </span>
          </Plain>
        );
      case "labels":
        return (
          <Plain>
            {task.labels.map((label) => (
              <LabelChip
                key={label.name}
                name={label.name}
                color={label.color}
              />
            ))}
          </Plain>
        );
      case "cycle":
        return (
          <Plain>
            <IterationCw
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{demo.views.cycle}</span>
          </Plain>
        );
      default:
        return (
          <Plain>
            <DueChip label={formatDay(demo, task.end)} tone={dueTone(task)} />
          </Plain>
        );
    }
  };
  return (
    <tr
      data-demo={`row-${task.id}`}
      aria-selected={selected}
      className={cn("group h-9", selected ? "bg-accent/45" : undefined)}
    >
      <td
        className={cn(
          "sticky left-0 z-[5] border-border border-b p-0",
          selected ? "bg-accent" : "bg-background",
        )}
        style={{ width: first, minWidth: first, maxWidth: first }}
      >
        <div className="flex h-9 min-w-0 items-center gap-1.5 ps-2 pe-2">
          <ReplicaCheckbox
            checked={selected}
            label={fill(demo.viewSpreadsheet.select, { key })}
            onChange={() => dispatch({ type: "toggleSelect", id: task.id })}
            className={selected ? undefined : "opacity-60"}
          />
          <span className="size-4 shrink-0" />
          <span className="shrink-0 font-mono text-muted-foreground text-xs">
            {key}
          </span>
          <span className="min-w-0 truncate text-foreground">{task.title}</span>
        </div>
      </td>
      {columns.map((column) => (
        <td
          key={column.id}
          className={cn(
            "border-border border-b border-l p-0",
            column.id === "priority" && "relative",
          )}
          style={{ width: column.width, minWidth: column.width }}
        >
          {cell(column.id)}
        </td>
      ))}
      <td className="border-border border-b" />
    </tr>
  );
}

function Plain({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-8 min-w-0 items-center gap-1.5 overflow-hidden px-2 text-sm">
      {children}
    </div>
  );
}

/** The spreadsheet scene, ready to drop into a page. */
export function SpreadsheetViewDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(
    () => createSpreadsheetViewScene(copy.demo),
    [copy.demo],
  );
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.viewSpreadsheet.caption}
      description={copy.scenes.viewSpreadsheet.description}
      size={VIEW_STAGE_SIZE}
      compactSize={VIEW_STAGE_COMPACT}
      className={className}
    />
  );
}
