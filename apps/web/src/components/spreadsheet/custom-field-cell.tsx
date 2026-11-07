import { type ReactElement, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import CustomFieldValuePicker from "@/components/project/custom-field-value-picker";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import useSetCustomFieldValue from "@/hooks/mutations/custom-field/use-set-custom-field-value";
import {
  customFieldOptions,
  customFieldValueLabel,
} from "@/lib/task-query/custom-field-value";
import { toast } from "@/lib/toast";
import type { TaskQueryMeta, TaskQueryRow } from "@/types/task-query";
import { CellButton, LazyEditor, Plain } from "./spreadsheet-cell";

type Field = TaskQueryMeta["customFields"][number];

/** Typed values edit in place: Enter or leaving saves, Escape cancels. */
function InlineValueEditor({
  field,
  value,
  display,
  onSave,
}: {
  field: Field;
  value: string;
  display: string;
  onSave: (next: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const label = t("tasks:customFieldValue.edit", { name: field.name });

  if (draft === null) {
    return (
      <CellButton aria-label={label} onClick={() => setDraft(value)}>
        <span className="truncate">{display}</span>
      </CellButton>
    );
  }

  const commit = () => {
    onSave(draft);
    setDraft(null);
  };

  return (
    <Input
      autoFocus
      aria-label={label}
      value={draft}
      type={field.type === "number" ? "number" : "text"}
      className="h-8 rounded-none border-0 px-2 text-sm"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") {
          event.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}

/** Closed value lists and dates pick from a popover. */
function PickerEditor({
  field,
  value,
  trigger,
  onSave,
}: {
  field: Field;
  value: string;
  trigger: ReactElement;
  onSave: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align="start"
        className={field.type === "date" ? "w-auto p-0" : "w-56 p-0"}
      >
        <CustomFieldValuePicker
          field={{ ...field, options: customFieldOptions(field.options) }}
          value={value}
          onSelect={(next) => {
            setOpen(false);
            onSave(next);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** A custom field value in the spreadsheet, editable in place. */
export default function CustomFieldCell({
  row,
  fieldId,
  meta,
  canEdit,
}: {
  row: TaskQueryRow;
  fieldId: string;
  meta: TaskQueryMeta;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { mutate: setValue } = useSetCustomFieldValue();
  const field = meta.customFields.find((entry) => entry.id === fieldId);
  const stored =
    row.customFieldValues?.find((entry) => entry.fieldId === fieldId)?.value ??
    "";

  // Shows a save at once; the refetched row then takes over.
  const [pending, setPending] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: stored is the trigger
  useEffect(() => setPending(null), [stored]);
  const value = pending ?? stored;
  const display = customFieldValueLabel(field?.type, value, t);

  if (!field || !canEdit) {
    return (
      <Plain>
        <span className="truncate">{display}</span>
      </Plain>
    );
  }

  const save = (next: string) => {
    const trimmed = next.trim();
    if (trimmed === value) return;
    setPending(trimmed);
    setValue(
      {
        taskId: row.id,
        fieldId,
        value: trimmed,
        projectId: row.projectId,
      },
      {
        onError: (error) => {
          setPending(null);
          toast.error(error.message || t("tasks:customFieldValue.saveError"));
        },
      },
    );
  };

  if (field.type === "text" || field.type === "number") {
    return (
      <InlineValueEditor
        field={field}
        value={value}
        display={display}
        onSave={save}
      />
    );
  }

  return (
    <LazyEditor
      display={
        display ? (
          <span className="truncate">{display}</span>
        ) : (
          <span className="sr-only">
            {t("tasks:customFieldValue.edit", { name: field.name })}
          </span>
        )
      }
      editable
      renderEditor={(trigger) => (
        <PickerEditor
          field={field}
          value={value}
          trigger={trigger}
          onSave={save}
        />
      )}
    />
  );
}
