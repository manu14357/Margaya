import { SlidersHorizontal } from "lucide-react";
import { type JSX, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import useGetCustomFieldValuesByProject from "@/hooks/queries/custom-field/use-get-custom-field-values-by-project";
import useGetCustomFieldsByProject from "@/hooks/queries/custom-field/use-get-custom-fields-by-project";
import { customFieldValueLabel } from "@/lib/task-query/custom-field-value";
import { useScheduleViewPreferences } from "@/store/schedule-view-preferences";
import type { ScheduleFieldDisplay } from "./schedule-field-display";

// The custom field Calendar and Gantt show on tasks: one per project, chosen
// in either view and kept in this browser. Values load only while a field is
// chosen, through the board cards' own cached query.

export type ScheduleFieldOption = { id: string; name: string; type: string };

const NONE = "__none__";

export function useScheduleField(projectId: string) {
  const { t } = useTranslation();
  const storedId = useScheduleViewPreferences((state) =>
    projectId ? state.scheduleFieldByProject[projectId] : undefined,
  );
  const setScheduleField = useScheduleViewPreferences(
    (state) => state.setScheduleField,
  );
  const { data: definitions } = useGetCustomFieldsByProject(projectId);
  const fields = useMemo<ScheduleFieldOption[]>(
    () =>
      ((definitions ?? []) as ScheduleFieldOption[]).map(
        ({ id, name, type }) => ({ id, name, type }),
      ),
    [definitions],
  );
  // A field deleted since it was chosen reads as no field.
  const field = fields.find((candidate) => candidate.id === storedId) ?? null;
  const { data: values } = useGetCustomFieldValuesByProject(
    field ? projectId : "",
  );
  const display = useMemo<ScheduleFieldDisplay | null>(() => {
    if (!field) return null;
    const byTask = new Map<string, string>();
    for (const entry of values ?? []) {
      if (entry.fieldId !== field.id || !entry.value) continue;
      byTask.set(
        entry.taskId,
        customFieldValueLabel(field.type, entry.value, t),
      );
    }
    return { name: field.name, values: byTask };
  }, [field, values, t]);

  return {
    fields,
    fieldId: field?.id ?? null,
    setFieldId: (fieldId: string | null) =>
      setScheduleField(projectId, fieldId),
    display,
  };
}

type ScheduleFieldPickerProps = {
  fields: readonly ScheduleFieldOption[];
  value: string | null;
  onChange: (fieldId: string | null) => void;
};

/** The field choice; nothing when the project has no custom fields. */
export function ScheduleFieldPicker({
  fields,
  value,
  onChange,
}: ScheduleFieldPickerProps): JSX.Element | null {
  const { t } = useTranslation();
  if (fields.length === 0) return null;
  const chosen = fields.find((field) => field.id === value);
  return (
    <Select
      value={chosen ? chosen.id : NONE}
      onValueChange={(next) =>
        onChange(typeof next === "string" && next !== NONE ? next : null)
      }
    >
      <SelectTrigger
        size="sm"
        className="w-36 min-w-0 text-xs"
        aria-label={t("tasks:scheduleField.label")}
        title={t("tasks:scheduleField.label")}
      >
        <SlidersHorizontal aria-hidden="true" className="size-3.5" />
        <SelectValue>
          {chosen ? chosen.name : t("tasks:scheduleField.none")}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("tasks:scheduleField.none")}</SelectItem>
        {fields.map((field) => (
          <SelectItem key={field.id} value={field.id}>
            {field.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
