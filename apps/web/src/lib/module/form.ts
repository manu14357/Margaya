import type { Module, ModuleStatus } from "@/types/module";

export const MODULE_NAME_MAX = 255;
export const MODULE_DESCRIPTION_MAX = 5000;

export type ModuleFormValues = {
  name: string;
  description: string;
  status: ModuleStatus;
  startDate: string | null;
  targetDate: string | null;
  leadId: string | null;
  memberIds: string[];
};

export type ModuleFormError =
  | { field: "name"; key: "modules:form.nameRequired" }
  | { field: "name"; key: "modules:form.nameTooLong" }
  | { field: "description"; key: "modules:form.descriptionTooLong" }
  | { field: "targetDate"; key: "modules:form.dateOrder" };

export function moduleFormValues(
  module: Module | null | undefined,
): ModuleFormValues {
  return {
    name: module?.name ?? "",
    description: module?.description ?? "",
    status: module?.status ?? "backlog",
    startDate: module?.startDate ?? null,
    targetDate: module?.targetDate ?? null,
    leadId: module?.leadId ?? null,
    memberIds: module ? [...module.memberIds] : [],
  };
}

/**
 * The dialog's checks, mirroring the API's rules so most mistakes never
 * leave the browser. The server re-checks everything.
 */
export function validateModuleForm(
  values: ModuleFormValues,
): ModuleFormError[] {
  const errors: ModuleFormError[] = [];
  const name = values.name.trim();
  if (!name) {
    errors.push({ field: "name", key: "modules:form.nameRequired" });
  } else if (name.length > MODULE_NAME_MAX) {
    errors.push({ field: "name", key: "modules:form.nameTooLong" });
  }
  if (values.description.length > MODULE_DESCRIPTION_MAX) {
    errors.push({
      field: "description",
      key: "modules:form.descriptionTooLong",
    });
  }
  const { startDate, targetDate } = values;
  if (startDate && targetDate && startDate > targetDate) {
    errors.push({ field: "targetDate", key: "modules:form.dateOrder" });
  }
  return errors;
}

function sameIds(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** The create request: the name and status, plus whatever was filled in. */
export function createModulePayload(values: ModuleFormValues) {
  return {
    name: values.name.trim(),
    status: values.status,
    ...(values.description.trim() ? { description: values.description } : {}),
    ...(values.startDate ? { startDate: values.startDate } : {}),
    ...(values.targetDate ? { targetDate: values.targetDate } : {}),
    ...(values.leadId ? { leadId: values.leadId } : {}),
    ...(values.memberIds.length > 0 ? { memberIds: values.memberIds } : {}),
  };
}

/** The update request: only what changed; null clears a field. */
export function updateModulePayload(
  values: ModuleFormValues,
  original: ModuleFormValues,
) {
  const payload: {
    name?: string;
    description?: string | null;
    status?: ModuleStatus;
    startDate?: string | null;
    targetDate?: string | null;
    leadId?: string | null;
    memberIds?: string[];
  } = {};
  const name = values.name.trim();
  if (name !== original.name) payload.name = name;
  if (values.description !== original.description) {
    payload.description = values.description.trim() ? values.description : null;
  }
  if (values.status !== original.status) payload.status = values.status;
  if (values.startDate !== original.startDate) {
    payload.startDate = values.startDate;
  }
  if (values.targetDate !== original.targetDate) {
    payload.targetDate = values.targetDate;
  }
  if (values.leadId !== original.leadId) payload.leadId = values.leadId;
  if (!sameIds(values.memberIds, original.memberIds)) {
    payload.memberIds = values.memberIds;
  }
  return payload;
}

/** Whether the dialog holds unsaved edits. */
export function isModuleFormDirty(
  values: ModuleFormValues,
  original: ModuleFormValues,
): boolean {
  return (
    values.name !== original.name ||
    Object.keys(updateModulePayload(values, original)).length > 0
  );
}
