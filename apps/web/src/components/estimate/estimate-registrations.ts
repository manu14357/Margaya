import updateTaskEstimate from "@/fetchers/estimate/update-task-estimate";
import { invalidateTaskEstimates } from "@/hooks/mutations/estimate/invalidate-estimate-queries";
import { i18n } from "@/lib/i18n";
import { registerTaskPropertySlot } from "@/lib/task-property-slots";
import { toast } from "@/lib/toast";
import queryClient from "@/query-client";
import EstimateBulkAction from "./estimate-bulk-action";
import EstimateCardChip from "./estimate-card-chip";
import EstimatePickerChip from "./estimate-picker-chip";
import TaskEstimateContextSubmenu from "./task-estimate-context-submenu";
import TaskEstimateProperty from "./task-estimate-property";

// Everything the estimates slice adds to shared screens, registered once from
// src/feature-registrations.ts. Every slot is hidden while the project's
// estimates feature is off, and each component also hides itself until the
// project has an active estimate system.

const SLOT_ID = "estimate";
// After the cycle (10) and module (20) slots.
const SLOT_ORDER = 30;

registerTaskPropertySlot("sidebar", {
  id: SLOT_ID,
  feature: "estimates",
  order: SLOT_ORDER,
  Component: TaskEstimateProperty,
});

/** Gives a task created from the modal the picked estimate. */
export async function setCreatedTaskEstimate({
  task,
  value,
}: {
  task: { id: string; projectId: string };
  value: unknown;
}) {
  if (typeof value !== "string" || !value) return;
  try {
    await updateTaskEstimate(task.id, value);
  } catch {
    // The task exists either way; say that only the estimate failed.
    toast.error(i18n.t("tasks:estimate.updateError"));
  } finally {
    invalidateTaskEstimates(queryClient, task.projectId, [task.id]);
  }
}

registerTaskPropertySlot("createModal", {
  id: SLOT_ID,
  feature: "estimates",
  order: SLOT_ORDER,
  Component: EstimatePickerChip,
  afterCreate: setCreatedTaskEstimate,
});

registerTaskPropertySlot("cardChip", {
  id: SLOT_ID,
  feature: "estimates",
  order: SLOT_ORDER,
  Component: EstimateCardChip,
});

registerTaskPropertySlot("bulkAction", {
  id: SLOT_ID,
  feature: "estimates",
  order: SLOT_ORDER,
  Component: EstimateBulkAction,
});

registerTaskPropertySlot("contextMenu", {
  id: SLOT_ID,
  feature: "estimates",
  order: SLOT_ORDER,
  Component: TaskEstimateContextSubmenu,
});
