import { addYears, max, min, subYears } from "date-fns";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDateMedium } from "@/lib/format";

type GanttPeriodPickerProps = {
  start: Date;
  end: Date;
  /** The earliest and latest days the period may start on. */
  minimumStart: Date;
  maximumStart: Date;
  onPick: (start: Date) => void;
};

// The year list spans this many years either side of the start, not the
// whole allowed range: legacy dates can stretch that across millennia.
const YEAR_SPAN = 20;

/**
 * "Oct 18, 2026 – Dec 26, 2026": the shown period in the user's locale, its
 * start picked from a calendar. A native date field showed the browser's own
 * format next to the locale's, so the two ends read differently.
 */
export default function GanttPeriodPicker({
  start,
  end,
  minimumStart,
  maximumStart,
  onPick,
}: GanttPeriodPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="xs" className="font-normal">
            <span className="sr-only">{`${t("tasks:gantt.periodStart")} `}</span>
            {formatDateMedium(start)}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            captionLayout="dropdown"
            selected={start}
            defaultMonth={start}
            startMonth={max([minimumStart, subYears(start, YEAR_SPAN)])}
            endMonth={min([maximumStart, addYears(start, YEAR_SPAN)])}
            disabled={[{ before: minimumStart }, { after: maximumStart }]}
            onSelect={(date) => {
              if (!date) return;
              onPick(date);
              setOpen(false);
            }}
            className="bg-popover"
          />
        </PopoverContent>
      </Popover>
      <span className="text-muted-foreground text-xs">
        – {formatDateMedium(end)}
      </span>
    </>
  );
}
