import { useCallback, useMemo } from "react";
import { useStoredState } from "@/components/planning/use-stored-state";
import {
  DEFAULT_MODULE_DISPLAY,
  type ModuleDisplaySettings,
  moduleDisplayStorageKey,
  normalizeModuleDisplay,
} from "@/lib/module/display";

function isObject(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The modules page's layout, grouping, order and filters, per project. */
export function useModuleDisplay(projectId: string) {
  const [stored, setStored] = useStoredState<unknown>(
    moduleDisplayStorageKey(projectId),
    DEFAULT_MODULE_DISPLAY,
    isObject,
  );
  const display = useMemo(() => normalizeModuleDisplay(stored), [stored]);

  const update = useCallback(
    (patch: Partial<ModuleDisplaySettings>) =>
      setStored({ ...display, ...patch }),
    [display, setStored],
  );

  return [display, update] as const;
}
