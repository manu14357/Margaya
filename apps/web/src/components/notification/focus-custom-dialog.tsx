import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useFocusDialog,
  useFocusMode,
} from "@/components/notification/focus-mode";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_FOCUS_MS } from "@/lib/quiet-time";

function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "Until a time…": picks the end of a focus session (device time). */
export function FocusCustomDialog() {
  const { t } = useTranslation();
  const open = useFocusDialog((state) => state.open);
  const setOpen = useFocusDialog((state) => state.setOpen);
  const { startUntil } = useFocusMode();
  const inputId = useId();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValue(toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
    setInvalid(false);
  }, [open]);

  const now = new Date();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    // datetime-local is the device's wall clock.
    const end = new Date(value);
    const at = new Date();
    if (
      !Number.isFinite(end.getTime()) ||
      end.getTime() <= at.getTime() ||
      end.getTime() > at.getTime() + MAX_FOCUS_MS
    ) {
      setInvalid(true);
      return;
    }
    startUntil(end);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("navigation:focus.customTitle")}</DialogTitle>
            <DialogDescription>
              {t("navigation:focus.customDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="grid gap-2">
              <Label htmlFor={inputId}>
                {t("navigation:focus.customLabel")}
              </Label>
              <Input
                id={inputId}
                type="datetime-local"
                value={value}
                min={toLocalInput(now)}
                max={toLocalInput(new Date(now.getTime() + MAX_FOCUS_MS))}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${inputId}-error` : undefined}
                onChange={(event) => {
                  setValue(event.target.value);
                  setInvalid(false);
                }}
                required
              />
              {invalid && (
                <p
                  id={`${inputId}-error`}
                  role="alert"
                  className="text-destructive-foreground text-xs"
                >
                  {t("navigation:focus.customInvalid")}
                </p>
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t("navigation:focus.cancel")}
            </Button>
            <Button type="submit">{t("navigation:focus.customSave")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
