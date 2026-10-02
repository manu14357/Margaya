import { AlarmClock, CalendarDays, ChevronLeft } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTriageIntakeItem } from "@/hooks/mutations/intake/use-triage-intake-item";
import {
  formatSnoozeDay,
  INTAKE_SNOOZE_PRESET_LABEL_KEYS,
  INTAKE_SNOOZE_PRESETS,
  intakeSnoozeBounds,
  intakeSnoozePresetDay,
  snoozeInstant,
} from "@/lib/intake-snooze";
import { toast } from "@/lib/toast";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { IntakeItem } from "@/types/intake";

/** Presets with their target day, and "Pick a date…" for the calendar. */
export function SnoozeIntakeOptions({
  onPick,
  disabled,
}: {
  onPick: (day: Date) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const [picking, setPicking] = useState(false);
  const [now] = useState(() => new Date());
  const { min, max } = intakeSnoozeBounds(now);

  if (picking) {
    return (
      <div className="flex flex-col">
        <Button
          variant="ghost"
          size="xs"
          className="m-1 w-fit gap-1 text-muted-foreground"
          onClick={() => setPicking(false)}
        >
          <ChevronLeft className="size-3" />
          {t("intake:snooze.back")}
        </Button>
        <Calendar
          mode="single"
          onSelect={(day) => day && onPick(day)}
          disabled={[{ before: min }, { after: max }]}
          className="w-full bg-popover"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col p-1">
      <span className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
        {t("intake:snooze.title")}
      </span>
      {INTAKE_SNOOZE_PRESETS.map((preset) => {
        const day = intakeSnoozePresetDay(preset, now, weekStartsOn);
        return (
          <Button
            key={preset}
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="h-8 justify-between gap-4 px-2 font-normal"
            onClick={() => onPick(day)}
          >
            {t(INTAKE_SNOOZE_PRESET_LABEL_KEYS[preset])}
            <span className="text-muted-foreground text-xs">
              {formatSnoozeDay(day)}
            </span>
          </Button>
        );
      })}
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        className="h-8 justify-start gap-2 px-2 font-normal"
        onClick={() => setPicking(true)}
      >
        <CalendarDays className="size-3.5" />
        {t("intake:snooze.pickDate")}
      </Button>
    </div>
  );
}

/** Snoozes the request until the start of the picked day, local time. */
function useSnooze(item: IntakeItem, onDone: (changed: IntakeItem) => void) {
  const { t } = useTranslation();
  const triage = useTriageIntakeItem();
  const snooze = (day: Date) =>
    triage.mutate(
      {
        id: item.id,
        projectId: item.projectId,
        action: "snooze",
        until: snoozeInstant(day),
      },
      {
        onSuccess: (changed) => {
          onDone(changed);
          toast.success(
            t("intake:snooze.toast", { date: formatSnoozeDay(day) }),
          );
        },
        onError: (error) =>
          toast.error(error.message || t("intake:snooze.error")),
      },
    );
  return { snooze, isPending: triage.isPending };
}

type SnoozeIntakePopoverProps = {
  item: IntakeItem;
  onSnoozed?: (item: IntakeItem) => void;
  children?: ReactNode;
  /** Controlled open state, e.g. opened by the triage queue's S key. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** The header's "Snooze" button and its preset popover. */
export default function SnoozeIntakePopover({
  item,
  onSnoozed,
  children,
  open: openProp,
  onOpenChange,
}: SnoozeIntakePopoverProps) {
  const { t } = useTranslation();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const { snooze, isPending } = useSnooze(item, (changed) => {
    setOpen(false);
    onSnoozed?.(changed);
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children ?? (
          <Button variant="outline" size="xs" className="gap-1">
            <AlarmClock className="size-3" />
            {t("intake:actions.snooze")}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="end">
        {open && <SnoozeIntakeOptions onPick={snooze} disabled={isPending} />}
      </PopoverContent>
    </Popover>
  );
}

/** "Change snooze date", opened from the actions menu. */
export function SnoozeIntakeDialog({
  item,
  open,
  onOpenChange,
  onSnoozed,
}: {
  item: IntakeItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnoozed?: (item: IntakeItem) => void;
}) {
  const { t } = useTranslation();
  const { snooze, isPending } = useSnooze(item, (changed) => {
    onOpenChange(false);
    onSnoozed?.(changed);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xs">
        <DialogHeader>
          <DialogTitle>{t("intake:actions.snoozeAgain")}</DialogTitle>
        </DialogHeader>
        <DialogPanel className="p-0">
          {open && <SnoozeIntakeOptions onPick={snooze} disabled={isPending} />}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
