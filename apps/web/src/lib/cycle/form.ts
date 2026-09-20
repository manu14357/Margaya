import { daysBetween } from "./dates";
import { findOverlappingCycle } from "./overlap";

export const CYCLE_NAME_MAX = 255;
export const CYCLE_DESCRIPTION_MAX = 10_000;
/** end − start in days; an inclusive range of at most 366 days. */
export const CYCLE_MAX_SPAN_DAYS = 365;

export type CycleFormValues = {
  name: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  ownerId: string | null;
};

export type CycleFormError =
  | { field: "name"; key: "cycles:form.errors.nameRequired" }
  | { field: "name"; key: "cycles:form.errors.nameTooLong" }
  | { field: "description"; key: "cycles:form.errors.descriptionTooLong" }
  | { field: "dates"; key: "cycles:form.errors.bothDates" }
  | { field: "dates"; key: "cycles:form.errors.endBeforeStart" }
  | { field: "dates"; key: "cycles:form.errors.tooLong" }
  | { field: "dates"; key: "cycles:form.errors.endInPast" }
  | { field: "dates"; key: "cycles:form.errors.overlap"; name: string };

type OtherCycle = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
};

/**
 * The dialog's pre-submit checks, mirroring the API's date rules. The
 * server re-checks everything; this only spares a round trip.
 */
export function validateCycleForm(
  values: CycleFormValues,
  {
    cycleId,
    isRunning = false,
    today,
    otherCycles = [],
  }: {
    /** The edited cycle, excluded from the overlap check. */
    cycleId?: string;
    /** Editing the current cycle: its end can't move before today. */
    isRunning?: boolean;
    today?: string;
    otherCycles?: readonly OtherCycle[];
  } = {},
): CycleFormError[] {
  const errors: CycleFormError[] = [];
  const name = values.name.trim();
  if (!name) {
    errors.push({ field: "name", key: "cycles:form.errors.nameRequired" });
  } else if (name.length > CYCLE_NAME_MAX) {
    errors.push({ field: "name", key: "cycles:form.errors.nameTooLong" });
  }
  if (values.description.length > CYCLE_DESCRIPTION_MAX) {
    errors.push({
      field: "description",
      key: "cycles:form.errors.descriptionTooLong",
    });
  }

  const { startDate, endDate } = values;
  if (Boolean(startDate) !== Boolean(endDate)) {
    errors.push({ field: "dates", key: "cycles:form.errors.bothDates" });
    return errors;
  }
  if (!startDate || !endDate) return errors;

  if (startDate > endDate) {
    errors.push({ field: "dates", key: "cycles:form.errors.endBeforeStart" });
    return errors;
  }
  if (daysBetween(startDate, endDate) > CYCLE_MAX_SPAN_DAYS) {
    errors.push({ field: "dates", key: "cycles:form.errors.tooLong" });
    return errors;
  }
  if (isRunning && today && endDate < today) {
    errors.push({ field: "dates", key: "cycles:form.errors.endInPast" });
    return errors;
  }
  const conflict = findOverlappingCycle(
    { startDate, endDate },
    otherCycles,
    cycleId,
  );
  if (conflict) {
    errors.push({
      field: "dates",
      key: "cycles:form.errors.overlap",
      name: conflict.name,
    });
  }
  return errors;
}

/** The create request: every field, the owner only when set. */
export function createCyclePayload(values: CycleFormValues) {
  return {
    name: values.name.trim(),
    description: values.description,
    startDate: values.startDate,
    endDate: values.endDate,
    ...(values.ownerId ? { ownerId: values.ownerId } : {}),
  };
}

/**
 * The update request: only what changed, with both dates together whenever
 * either one changed.
 */
export function updateCyclePayload(
  values: CycleFormValues,
  original: CycleFormValues,
) {
  const name = values.name.trim();
  const payload: {
    name?: string;
    description?: string;
    startDate?: string | null;
    endDate?: string | null;
    ownerId?: string | null;
  } = {};
  if (name !== original.name) payload.name = name;
  if (values.description !== original.description) {
    payload.description = values.description;
  }
  if (
    values.startDate !== original.startDate ||
    values.endDate !== original.endDate
  ) {
    payload.startDate = values.startDate;
    payload.endDate = values.endDate;
  }
  if (values.ownerId !== original.ownerId) payload.ownerId = values.ownerId;
  return payload;
}
