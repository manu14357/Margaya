import { type ComponentType, Fragment, type ReactNode } from "react";
import {
  isProjectFeatureEnabled,
  type ProjectFeatureKey,
} from "@/constants/project-features";
import useGetProject from "@/hooks/queries/project/use-get-project";
import type Task from "@/types/task";

/**
 * Task property slots: mount points where feature slices (cycles, modules,
 * estimates, ...) add their task properties without editing shared screens.
 *
 * Register from the slice's own file, at module load:
 *
 *   registerTaskPropertySlot("sidebar", {
 *     id: "cycle",
 *     feature: "cycles",   // hidden while the feature is off or unavailable
 *     order: 10,           // ascending within a location
 *     Component: TaskCyclePicker,
 *   });
 *
 * Locations and the props each Component receives (all get projectId and
 * workspaceId):
 * - sidebar:     { task, layout }  task properties sidebar; layout "row" is
 *                the compact/mobile chip row, "stack" the desktop column.
 * - createModal: { value, onChange }  create-task modal pill row. The modal
 *                keeps one value per slot and, after the task is created,
 *                calls the slot's `afterCreate({ task, value })`.
 * - cardChip:    { task }  the chip row of kanban cards, list-view rows and
 *                backlog rows; a chip hides itself when it has nothing to show.
 * - bulkAction:  { taskIds, surface, onDone }  bulk selection toolbars; the
 *                host wraps each slot in its own toolbar group.
 * - contextMenu: { task }  the task card and row right-click menu; a slot
 *                renders context-menu items (usually one submenu). The menu
 *                mounts only while open, so slots fetch on demand.
 *
 * Hosts render an outlet, passing the ids and the location's own props:
 *
 *   <TaskPropertySlotOutlet location="cardChip" projectId={...}
 *     workspaceId={...} props={{ task }} />
 *
 * With nothing registered every outlet renders null and runs no hooks.
 */

type SlotContext = { projectId: string; workspaceId: string };

export type TaskPropertySlotProps = {
  sidebar: SlotContext & { task: Task; layout: "row" | "stack" };
  createModal: SlotContext & {
    value: unknown;
    onChange: (value: unknown) => void;
  };
  cardChip: SlotContext & { task: Task };
  bulkAction: SlotContext & {
    taskIds: string[];
    surface: "board" | "backlog";
    onDone: () => void;
  };
  contextMenu: SlotContext & { task: Task };
};

export type TaskPropertySlotLocation = keyof TaskPropertySlotProps;

export type TaskPropertySlot<L extends TaskPropertySlotLocation> = {
  id: string;
  feature?: ProjectFeatureKey;
  order?: number;
  Component: ComponentType<TaskPropertySlotProps[L]>;
  /** createModal only: persist the slot's value once the task exists. */
  afterCreate?: (args: {
    task: { id: string; projectId: string };
    value: unknown;
  }) => Promise<void> | void;
};

type SlotRegistry = {
  [L in TaskPropertySlotLocation]: TaskPropertySlot<L>[];
};

const registry: SlotRegistry = {
  sidebar: [],
  createModal: [],
  cardChip: [],
  bulkAction: [],
  contextMenu: [],
};

/** Adds a slot; returns a function that removes it (for tests). */
export function registerTaskPropertySlot<L extends TaskPropertySlotLocation>(
  location: L,
  slot: TaskPropertySlot<L>,
): () => void {
  const slots = registry[location] as TaskPropertySlot<L>[];
  const existing = slots.findIndex((candidate) => candidate.id === slot.id);
  if (existing !== -1) slots.splice(existing, 1);
  slots.push(slot);
  slots.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return () => {
    const index = slots.indexOf(slot);
    if (index !== -1) slots.splice(index, 1);
  };
}

export function getTaskPropertySlots<L extends TaskPropertySlotLocation>(
  location: L,
): readonly TaskPropertySlot<L>[] {
  return registry[location] as TaskPropertySlot<L>[];
}

/** Slots whose feature is on (or that need none). */
export function filterSlotsByFeature<L extends TaskPropertySlotLocation>(
  slots: readonly TaskPropertySlot<L>[],
  isFeatureEnabled: (feature: ProjectFeatureKey) => boolean,
): TaskPropertySlot<L>[] {
  return slots.filter(
    (slot) => slot.feature === undefined || isFeatureEnabled(slot.feature),
  );
}

/**
 * Runs `afterCreate` for every create-modal slot that holds a value. Errors
 * are collected so one failing slot does not hide the others.
 */
export async function runCreateModalSlots({
  task,
  values,
}: {
  task: { id: string; projectId: string };
  values: Record<string, unknown>;
}): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const slot of getTaskPropertySlots("createModal")) {
    const value = values[slot.id];
    if (value === undefined || !slot.afterCreate) continue;
    try {
      await slot.afterCreate({ task, value });
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

type SlotOwnProps<L extends TaskPropertySlotLocation> = Omit<
  TaskPropertySlotProps[L],
  keyof SlotContext
>;

type OutletProps<L extends TaskPropertySlotLocation> = SlotContext & {
  location: L;
  /** The location's props, or a function of the slot for per-slot props. */
  props: SlotOwnProps<L> | ((slot: TaskPropertySlot<L>) => SlotOwnProps<L>);
  /** Wraps each rendered slot, for hosts that need a container per slot. */
  renderSlot?: (node: ReactNode, slot: TaskPropertySlot<L>) => ReactNode;
};

function SlotOutletContent<L extends TaskPropertySlotLocation>({
  slots,
  projectId,
  workspaceId,
  props,
  renderSlot,
}: Omit<OutletProps<L>, "location"> & {
  slots: readonly TaskPropertySlot<L>[];
}) {
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const visible = filterSlotsByFeature(slots, (feature) =>
    isProjectFeatureEnabled(project, feature),
  );

  return (
    <>
      {visible.map((slot) => {
        const own = typeof props === "function" ? props(slot) : props;
        const slotProps = {
          ...own,
          projectId,
          workspaceId,
        } as TaskPropertySlotProps[L];
        const node = <slot.Component {...slotProps} />;
        return (
          <Fragment key={slot.id}>
            {renderSlot ? renderSlot(node, slot) : node}
          </Fragment>
        );
      })}
    </>
  );
}

export function TaskPropertySlotOutlet<L extends TaskPropertySlotLocation>({
  location,
  ...rest
}: OutletProps<L>) {
  const slots = getTaskPropertySlots(location);
  // Registration happens at module load, so this check is stable per render
  // tree and an empty location costs nothing.
  if (slots.length === 0 || !rest.projectId) return null;
  return <SlotOutletContent slots={slots} {...rest} />;
}
