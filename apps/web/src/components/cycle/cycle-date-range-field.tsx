import { CalendarIcon, X } from "lucide-react";
import { useState } from "react";
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
  formatCycleDate,
  parseCycleDate,
  toCycleDateString,
} from "@/lib/cycle/dates";

export type CycleDateRange = {
  startDate: string | null;
  endDate: string | null;
};

type CycleDateRangeFieldProps = CycleDateRange & {
  id?: string;
  onChange: (range: CycleDateRange) => void;
  /** Today's date (YYYY-MM-DD); earlier days can't start a new range. */
  today: string;
  /** A running cycle: the start stays, only the end can move. */
  startLocked?: boolean;
  disabled?: boolean;
  invalid?: boolean;
};

/** The start and end days of a cycle, or none for a draft. */
export default function CycleDateRangeField({
  id,
  startDate,
  endDate,
  onChange,
  today,
  startLocked = false,
  disabled,
  invalid,
}: CycleDateRangeFieldProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const todayDate = parseCycleDate(today);
  const from = startDate ? parseCycleDate(startDate) : undefined;
  const to = endDate ? parseCycleDate(endDate) : undefined;

  const label =
    startDate && endDate
      ? `${formatCycleDate(startDate)} – ${formatCycleDate(endDate)}`
      : startDate
        ? `${formatCycleDate(startDate)} – …`
        : t("cycles:form.datesPlaceholder");

  // New ranges can't begin in the past; an existing range keeps its days
  // selectable so editing a draft or upcoming cycle never traps the user.
  const earliest = startDate && startDate < today ? from : todayDate;

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={invalid || undefined}
            className={cn(
              "min-w-0 flex-1 justify-start font-normal",
              !startDate && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="size-4 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          {startLocked ? (
            <Calendar
              mode="single"
              selected={to}
              defaultMonth={to ?? todayDate}
              disabled={{ before: from && from > todayDate ? from : todayDate }}
              onSelect={(date) => {
                if (!date) return;
                onChange({ startDate, endDate: toCycleDateString(date) });
                setOpen(false);
              }}
              className="bg-popover"
            />
          ) : (
            <Calendar
              mode="range"
              selected={from ? { from, to } : undefined}
              defaultMonth={from ?? todayDate}
              disabled={earliest ? { before: earliest } : undefined}
              numberOfMonths={1}
              onSelect={(range) => {
                onChange({
                  startDate: range?.from ? toCycleDateString(range.from) : null,
                  endDate: range?.to ? toCycleDateString(range.to) : null,
                });
              }}
              className="bg-popover"
            />
          )}
        </PopoverContent>
      </Popover>
      {!startLocked && startDate && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={t("cycles:form.clearDates")}
          title={t("cycles:form.clearDates")}
          onClick={() => onChange({ startDate: null, endDate: null })}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}
