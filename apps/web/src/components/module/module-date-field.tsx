import { CalendarIcon, X } from "lucide-react";
import { type ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import {
  formatModuleDate,
  parseModuleDate,
  toModuleDateString,
} from "@/lib/module/dates";

type ModuleDateFieldProps = {
  id?: string;
  /** YYYY-MM-DD, or null for none. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Days before this one can't be picked (the target after the start). */
  min?: string | null;
  /** Days after this one can't be picked (the start before the target). */
  max?: string | null;
  disabled?: boolean;
  invalid?: boolean;
  /** A custom trigger; defaults to a full-width outline button. */
  children?: ReactElement;
};

/** One calendar day of a module, with a "Clear date" action. */
export default function ModuleDateField({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  invalid,
  children,
}: ModuleDateFieldProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = value ? parseModuleDate(value) : undefined;
  const before = min ? parseModuleDate(min) : undefined;
  const after = max ? parseModuleDate(max) : undefined;

  const trigger = children ?? (
    <Button
      id={id}
      type="button"
      variant="outline"
      disabled={disabled}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full justify-start font-normal",
        !value && "text-muted-foreground",
      )}
    >
      <CalendarIcon className="size-4 text-muted-foreground" />
      <span className="truncate">
        {value ? formatModuleDate(value) : t("modules:form.noDate")}
      </span>
    </Button>
  );

  if (disabled) return trigger;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? before ?? after}
          disabled={[
            ...(before ? [{ before }] : []),
            ...(after ? [{ after }] : []),
          ]}
          onSelect={(date) => {
            if (!date) return;
            onChange(toModuleDateString(date));
            setOpen(false);
          }}
          className="bg-popover"
        />
        {value && (
          <div className="border-t p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-muted-foreground"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <X className="size-4" />
              {t("modules:form.clearDate")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
