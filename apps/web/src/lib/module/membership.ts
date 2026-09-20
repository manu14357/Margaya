import type {
  ModuleStatus,
  ModuleTaskChange,
  ModuleTaskMapEntry,
  TaskModuleRef,
} from "@/types/module";

type NamedModule = { id: string; name: string; status: ModuleStatus };

/** The API lists a task's modules by name, ignoring case. */
function byName(a: NamedModule, b: NamedModule) {
  return (
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * A task's module list after joining and leaving modules, for optimistic
 * updates. `modules` supplies names and statuses; unknown ids are skipped.
 */
export function applyTaskModuleChange(
  refs: readonly TaskModuleRef[],
  modules: readonly NamedModule[],
  addModuleIds: readonly string[],
  removeModuleIds: readonly string[],
): TaskModuleRef[] {
  const removed = new Set(removeModuleIds);
  const next = refs.filter((ref) => !removed.has(ref.id));
  for (const moduleId of addModuleIds) {
    if (next.some((ref) => ref.id === moduleId)) continue;
    const found = modules.find((candidate) => candidate.id === moduleId);
    if (found) {
      next.push({ id: found.id, name: found.name, status: found.status });
    }
  }
  return next.sort(byName);
}

/** The project's task map after one task joins and leaves modules. */
export function applyTaskMapChange(
  entries: readonly ModuleTaskMapEntry[],
  taskId: string,
  addModuleIds: readonly string[],
  removeModuleIds: readonly string[],
): ModuleTaskMapEntry[] {
  const removed = new Set(removeModuleIds);
  const next = entries.filter(
    (entry) => !(entry.taskId === taskId && removed.has(entry.moduleId)),
  );
  for (const moduleId of addModuleIds) {
    const exists = next.some(
      (entry) => entry.taskId === taskId && entry.moduleId === moduleId,
    );
    if (!exists) next.push({ taskId, moduleId });
  }
  return next;
}

/** One summary for the batches of a bulk add or remove. */
export function mergeModuleTaskChanges(
  moduleId: string,
  changes: readonly ModuleTaskChange[],
): ModuleTaskChange {
  return {
    moduleId,
    added: changes.flatMap((change) => change.added),
    removed: changes.flatMap((change) => change.removed),
    unchanged: changes.flatMap((change) => change.unchanged),
    ignored: changes.flatMap((change) => change.ignored),
  };
}
