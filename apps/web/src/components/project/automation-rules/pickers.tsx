import { X } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Option } from "./use-rule-options";

// Small controls for the builder rows: one choice, several choices as
// removable chips, and a label name with suggestions.

export function SinglePicker({
  value,
  options,
  label,
  placeholder,
  disabled,
  onChange,
  className = "h-8 w-44 text-sm",
}: {
  value: string;
  options: readonly Option[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const current = options.find((option) => option.id === value);
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === "string" && next) onChange(next);
      }}
    >
      <SelectTrigger className={className} aria-label={label}>
        <SelectValue>
          {current?.name ??
            placeholder ??
            t("settings:automationRules.editor.choose")}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function MultiPicker({
  values,
  options,
  label,
  emptyLabel,
  disabled,
  onChange,
}: {
  values: readonly string[];
  options: readonly Option[];
  label: string;
  /** Shown when nothing is chosen (e.g. "Any"). */
  emptyLabel?: string;
  disabled?: boolean;
  onChange: (values: string[]) => void;
}) {
  const { t } = useTranslation();
  const remaining = options.filter((option) => !values.includes(option.id));
  const nameOf = (id: string) =>
    options.find((option) => option.id === id)?.name ?? id;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {values.length === 0 && emptyLabel && (
        <span className="text-muted-foreground text-xs">{emptyLabel}</span>
      )}
      {values.map((id) => (
        <span
          key={id}
          className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-xs"
        >
          {nameOf(id)}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("settings:automationRules.editor.removeItem", {
              name: nameOf(id),
            })}
            disabled={disabled}
            onClick={() => onChange(values.filter((value) => value !== id))}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      {remaining.length > 0 && (
        <Select
          value=""
          disabled={disabled}
          onValueChange={(next) => {
            if (typeof next === "string" && next) onChange([...values, next]);
          }}
        >
          <SelectTrigger className="h-7 w-32 text-xs" aria-label={label}>
            <SelectValue>
              {t("settings:automationRules.editor.add")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {remaining.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export function LabelInput({
  value,
  labels,
  label,
  disabled,
  onChange,
}: {
  value: string;
  labels: readonly string[];
  label: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  return (
    <>
      <Input
        value={value}
        list={listId}
        maxLength={50}
        disabled={disabled}
        aria-label={label}
        className="h-8 w-44 text-sm"
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {labels.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
  );
}
