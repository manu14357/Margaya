import { addDays } from "date-fns";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  combineDateAndSlot,
  defaultSlot,
  formatSlotLabel,
  SNOOZE_SLOTS,
  slotsAllowedFor,
  startOfLocalDay,
} from "@/lib/snooze-presets";

type SnoozeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (until: Date) => void;
};

/** "Snooze until": a date and a half-hour slot in the browser's zone. */
export default function SnoozeDialog({
  open,
  onOpenChange,
  onSnooze,
}: SnoozeDialogProps) {
  const { t } = useTranslation();
  const [date, setDate] = useState<Date | undefined>();
  const [slot, setSlot] = useState<string | null>(null);

  // Each opening starts from tomorrow at the default time.
  useEffect(() => {
    if (!open) return;
    const tomorrow = addDays(startOfLocalDay(new Date()), 1);
    setDate(tomorrow);
    setSlot(defaultSlot(tomorrow));
  }, [open]);

  const today = startOfLocalDay(new Date());
  const allowed = date ? new Set(slotsAllowedFor(date)) : new Set<string>();
  const valid = Boolean(date && slot && allowed.has(slot));

  const handleDateChange = (next: Date | undefined) => {
    setDate(next);
    if (!next) return;
    const nextAllowed = slotsAllowedFor(next);
    setSlot((current) =>
      current && nextAllowed.includes(current) ? current : defaultSlot(next),
    );
  };

  const handleSubmit = () => {
    if (!date || !slot || !valid) return;
    onSnooze(combineDateAndSlot(date, slot));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("notifications:inbox.snooze.dialogTitle")}
          </DialogTitle>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-muted-foreground text-xs">
              {t("notifications:inbox.snooze.date")}
            </span>
            <Calendar
              mode="single"
              selected={date}
              onSelect={handleDateChange}
              disabled={[{ before: today }, { after: addDays(today, 365) }]}
              className="w-full rounded-lg border bg-popover"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-muted-foreground text-xs">
              {t("notifications:inbox.snooze.time")}
            </span>
            <Select
              value={slot ?? ""}
              onValueChange={(value) => setSlot((value as string) || null)}
              disabled={!date}
            >
              <SelectTrigger aria-label={t("notifications:inbox.snooze.time")}>
                <SelectValue>
                  {slot
                    ? formatSlotLabel(slot)
                    : t("notifications:inbox.snooze.pickTime")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SNOOZE_SLOTS.map((value) => (
                  <SelectItem
                    key={value}
                    value={value}
                    disabled={!allowed.has(value)}
                  >
                    {formatSlotLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!valid}>
            {t("notifications:inbox.snooze.submit")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
