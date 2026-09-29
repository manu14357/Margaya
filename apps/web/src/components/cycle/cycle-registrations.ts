import { IterationCw } from "lucide-react";
import addCycleTasks from "@/fetchers/cycle/add-cycle-tasks";
import { invalidateCycleMembership } from "@/hooks/mutations/cycle/invalidate-cycle-queries";
import { cycleEntityLink } from "@/lib/cycle/entity-link";
import { registerEntityLink } from "@/lib/entity-links";
import { i18n } from "@/lib/i18n";
import { registerProjectSection } from "@/lib/project-sections";
import { registerTaskPropertySlot } from "@/lib/task-property-slots";
import { toast } from "@/lib/toast";
import queryClient from "@/query-client";
import CycleBulkAction from "./cycle-bulk-action";
import CycleCardChip from "./cycle-card-chip";
import CyclePickerChip from "./cycle-picker-chip";
import TaskCycleContextSubmenu from "./task-cycle-context-submenu";
import TaskCycleProperty from "./task-cycle-property";

// Everything the cycles slice adds to shared screens, registered once from
// src/feature-registrations.ts. Every slot is hidden while the project's
// cycles feature is off.

registerProjectSection({
  id: "cycles",
  labelKey: "navigation:projectNav.cycles",
  icon: IterationCw,
  feature: "cycles",
  segment: "cycles",
  shortcutKey: "c",
});

registerEntityLink("cycle", cycleEntityLink);

const SLOT_ID = "cycle";
const SLOT_ORDER = 10;

registerTaskPropertySlot("sidebar", {
  id: SLOT_ID,
  feature: "cycles",
  order: SLOT_ORDER,
  Component: TaskCycleProperty,
});

/** Puts a task created from the modal into the picked cycle. */
export async function addCreatedTaskToCycle({
  task,
  value,
}: {
  task: { id: string; projectId: string };
  value: unknown;
}) {
  if (typeof value !== "string" || !value) return;
  try {
    await addCycleTasks(value, [task.id]);
  } catch {
    // The task exists either way; say that only the cycle step failed.
    toast.error(i18n.t("cycles:toast.addAfterCreateError"));
  } finally {
    invalidateCycleMembership(queryClient, task.projectId, [task.id]);
  }
}

registerTaskPropertySlot("createModal", {
  id: SLOT_ID,
  feature: "cycles",
  order: SLOT_ORDER,
  Component: CyclePickerChip,
  afterCreate: addCreatedTaskToCycle,
});

registerTaskPropertySlot("cardChip", {
  id: SLOT_ID,
  feature: "cycles",
  order: SLOT_ORDER,
  Component: CycleCardChip,
});

registerTaskPropertySlot("bulkAction", {
  id: SLOT_ID,
  feature: "cycles",
  order: SLOT_ORDER,
  Component: CycleBulkAction,
});

registerTaskPropertySlot("contextMenu", {
  id: SLOT_ID,
  feature: "cycles",
  order: SLOT_ORDER,
  Component: TaskCycleContextSubmenu,
});
