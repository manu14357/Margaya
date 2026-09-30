import { Boxes } from "lucide-react";
import setTaskModules from "@/fetchers/module/set-task-modules";
import { invalidateModuleMembership } from "@/hooks/mutations/module/invalidate-module-queries";
import { registerEntityLink } from "@/lib/entity-links";
import { i18n } from "@/lib/i18n";
import { moduleEntityLink } from "@/lib/module/entity-link";
import { registerProjectSection } from "@/lib/project-sections";
import { registerTaskPropertySlot } from "@/lib/task-property-slots";
import { toast } from "@/lib/toast";
import queryClient from "@/query-client";
import ModuleBulkAction from "./module-bulk-action";
import ModulePickerChip from "./module-picker-chip";
import TaskCardModuleChips from "./task-card-module-chips";
import TaskModulesContextSubmenu from "./task-modules-context-submenu";
import TaskModulesProperty from "./task-modules-property";

// Everything the modules slice adds to shared screens, registered once from
// src/feature-registrations.ts. Every slot is hidden while the project's
// modules feature is off.

registerProjectSection({
  id: "modules",
  labelKey: "navigation:projectNav.modules",
  icon: Boxes,
  feature: "modules",
  segment: "modules",
  shortcutKey: "m",
});

registerEntityLink("module", moduleEntityLink);

const SLOT_ID = "module";
// After the cycle slots (order 10).
const SLOT_ORDER = 20;

registerTaskPropertySlot("sidebar", {
  id: SLOT_ID,
  feature: "modules",
  order: SLOT_ORDER,
  Component: TaskModulesProperty,
});

/** Puts a task created from the modal into the picked modules. */
export async function addCreatedTaskToModules({
  task,
  value,
}: {
  task: { id: string; projectId: string };
  value: unknown;
}) {
  const moduleIds = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
  if (moduleIds.length === 0) return;
  try {
    await setTaskModules(task.id, { addModuleIds: moduleIds });
  } catch {
    // The task exists either way; say that only the module step failed.
    toast.error(i18n.t("modules:toast.addAfterCreateError"));
  } finally {
    invalidateModuleMembership(queryClient, task.projectId, [task.id]);
  }
}

registerTaskPropertySlot("createModal", {
  id: SLOT_ID,
  feature: "modules",
  order: SLOT_ORDER,
  Component: ModulePickerChip,
  afterCreate: addCreatedTaskToModules,
});

registerTaskPropertySlot("cardChip", {
  id: SLOT_ID,
  feature: "modules",
  order: SLOT_ORDER,
  Component: TaskCardModuleChips,
});

registerTaskPropertySlot("bulkAction", {
  id: SLOT_ID,
  feature: "modules",
  order: SLOT_ORDER,
  Component: ModuleBulkAction,
});

registerTaskPropertySlot("contextMenu", {
  id: SLOT_ID,
  feature: "modules",
  order: SLOT_ORDER,
  Component: TaskModulesContextSubmenu,
});
