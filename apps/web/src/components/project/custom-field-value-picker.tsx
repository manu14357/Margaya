import { format, isValid, parseISO } from "date-fns";
import { Check, X } from "lucide-react";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { customFieldOptions } from "@/lib/task-query/custom-field-value";

// The custom-field slots are registered at startup, so a static import put the
// date picker library on every first page load; it loads with a date field.
const Calendar = lazy(() =>
  import("@/components/ui/calendar").then(({ Calendar }) => ({
    default: Calendar,
  })),
);

type PickerField = {
  type: string;
  required: boolean;
  options: unknown;
};

type CustomFieldValuePickerProps = {
  field: PickerField;
  /** The current value; "" when there is none or the selection differs. */
  value: string;
  onSelect: (value: string) => void;
};

/**
 * Picks a value from a closed list: a dropdown's options, true or false, or a
 * day. Used inside popovers by spreadsheet cells and the bulk toolbar. Clearing
 * selects "", which required fields don't offer.
 */
export default function CustomFieldValuePicker({
  field,
  value,
  onSelect,
}: CustomFieldValuePickerProps) {
  const { t } = useTranslation();

  const clear = !field.required && (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2 rounded-none text-muted-foreground"
      onClick={() => onSelect("")}
    >
      <X className="size-4" />
      {t("tasks:customFieldValue.clear")}
    </Button>
  );

  if (field.type === "date") {
    const selected = value && isValid(parseISO(value)) ? parseISO(value) : null;
    return (
      <div>
        <Suspense fallback={null}>
          <Calendar
            mode="single"
            selected={selected ?? undefined}
            onSelect={(date) => {
              if (date) onSelect(format(date, "yyyy-MM-dd"));
            }}
            captionLayout="dropdown"
          />
        </Suspense>
        {clear && <div className="border-border border-t">{clear}</div>}
      </div>
    );
  }

  const choices: Array<{ value: string; label: string }> =
    field.type === "boolean"
      ? [
          { value: "true", label: t("tasks:customFieldValue.true") },
          { value: "false", label: t("tasks:customFieldValue.false") },
        ]
      : customFieldOptions(field.options).map((option) => ({
          value: option,
          label: option,
        }));
  const isRemoved =
    field.type === "dropdown" &&
    value !== "" &&
    !choices.some((choice) => choice.value === value);

  return (
    <div className="max-h-64 overflow-y-auto py-1">
      {choices.map((choice) => (
        <Button
          key={choice.value}
          variant="ghost"
          size="sm"
          aria-pressed={choice.value === value}
          className="w-full justify-between gap-2 rounded-none font-normal"
          onClick={() => onSelect(choice.value)}
        >
          <span className="truncate">{choice.label}</span>
          {choice.value === value && <Check className="size-4 shrink-0" />}
        </Button>
      ))}
      {isRemoved && (
        <p className="px-3 py-1.5 text-muted-foreground text-xs">
          {t("tasks:customFieldValue.removedOption", { value })}
        </p>
      )}
      {clear && <div className="mt-1 border-border border-t pt-1">{clear}</div>}
    </div>
  );
}
