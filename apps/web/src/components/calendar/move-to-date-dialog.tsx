import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CalendarTask } from "./calendar-task-bar";

type MoveToDateDialogProps = {
  /** The task being moved; null while closed. */
  task: CalendarTask | null;
  onClose: () => void;
  /** The picked day becomes the task's last day (its due date). */
  onMove: (task: CalendarTask, day: Date) => void;
};

/**
 * "Move to date" from the calendar's day agenda: the touch alternative to
 * dragging a bar. The picked day becomes the due date, and a start date
 * moves with it so the task keeps its length.
 */
export default function MoveToDateDialog({
  task,
  onClose,
  onMove,
}: MoveToDateDialogProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <Dialog
      open={task !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("tasks:calendar.touch.moveTitle")}</DialogTitle>
          <DialogDescription>
            {task
              ? t("tasks:calendar.touch.moveDescription", { title: task.title })
              : null}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex justify-center">
          {task ? (
            <Calendar
              mode="single"
              required
              selected={task.scheduleEnd}
              defaultMonth={task.scheduleEnd}
              onSelect={(day) => {
                if (day) onMove(task, day);
              }}
              // 44px days: this picker is reached from touch screens.
              className="[--cell-size:--spacing(11)]! sm:[--cell-size:--spacing(11)]!"
            />
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
