import { ChevronLeft, ChevronRight } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import type { CalendarMode } from "@/store/schedule-view-preferences";
import ViewChoice, { viewChoiceButtonClass } from "./view-choice";

type CalendarToolbarProps = {
  /** The visible month, or the first day of the visible week. */
  visibleDate: Date;
  /** The last day of the visible week (week mode only). */
  visibleEnd?: Date;
  mode: CalendarMode;
  onModeChange: (mode: CalendarMode) => void;
  showWeekends: boolean;
  onShowWeekendsChange: (show: boolean) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
};

/**
 * The period, its navigation and the display choices. It sits on the right
 * of the lens bar; the page heading is for screen readers, as the tab row
 * already names the view.
 */
export default function CalendarToolbar({
  visibleDate,
  visibleEnd,
  mode,
  onModeChange,
  showWeekends,
  onShowWeekendsChange,
  onPrevious,
  onNext,
  onToday,
}: CalendarToolbarProps): JSX.Element {
  const { t } = useTranslation();
  const isWeek = mode === "week";
  const periodLabel =
    isWeek && visibleEnd
      ? `${formatDate(visibleDate, { month: "short", day: "numeric" })} – ${formatDate(
          visibleEnd,
          { month: "short", day: "numeric", year: "numeric" },
        )}`
      : formatDate(visibleDate, { month: "long", year: "numeric" });

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <h1 className="sr-only">{t("tasks:calendar.title")}</h1>
      <ViewChoice
        label={t("tasks:calendar.viewMode")}
        value={mode}
        onChange={onModeChange}
        options={[
          { value: "month", label: t("tasks:calendar.month") },
          { value: "week", label: t("tasks:calendar.week") },
        ]}
      />
      <button
        type="button"
        aria-pressed={showWeekends}
        onClick={() => onShowWeekendsChange(!showWeekends)}
        className={viewChoiceButtonClass(showWeekends)}
      >
        {t("tasks:calendar.showWeekends")}
      </button>
      <span
        className="hidden truncate font-medium text-foreground text-xs sm:inline"
        data-testid="calendar-month-label"
      >
        {periodLabel}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          size="icon-xs"
          className="touch-manipulation"
          aria-label={
            isWeek
              ? t("tasks:calendar.previousWeek")
              : t("tasks:calendar.previousMonth")
          }
          onClick={onPrevious}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="xs"
          className="touch-manipulation"
          onClick={onToday}
        >
          {t("tasks:calendar.today")}
        </Button>
        <Button
          variant="outline"
          size="icon-xs"
          className="touch-manipulation"
          aria-label={
            isWeek
              ? t("tasks:calendar.nextWeek")
              : t("tasks:calendar.nextMonth")
          }
          onClick={onNext}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
