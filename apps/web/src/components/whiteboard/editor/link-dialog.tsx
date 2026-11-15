// These components read the board controller (history, collaborators,
// read-only state, the scene) while rendering. It is a mutable object whose
// identity never changes, so compiler memoisation would freeze those reads.
"use no memo";

import { isValidLink } from "@margaya/whiteboard";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BoardController } from "./controller";

/** Accepts a bare domain by adding https, as an address bar would. */
export function normaliseLink(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (isValidLink(value)) return value;
  const withScheme = `https://${value}`;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value) && isValidLink(withScheme))
    return withScheme;
  return null;
}

export function LinkDialog({
  open,
  onOpenChange,
  controller: c,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: BoardController;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const element = open ? c.selectedElements()[0] : undefined;

  useEffect(() => {
    if (!open) return;
    setValue(c.selectedElements()[0]?.link ?? "");
    setError(false);
  }, [open, c]);

  const save = () => {
    if (!element) return;
    if (!value.trim()) {
      c.patch([element], { link: null });
      onOpenChange(false);
      return;
    }
    const link = normaliseLink(value);
    if (!link) {
      setError(true);
      return;
    }
    c.patch([element], { link });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("whiteboardEditor:link.title")}</DialogTitle>
            <DialogDescription>
              {t("whiteboardEditor:link.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-1.5">
            <Label htmlFor={id}>{t("whiteboardEditor:link.label")}</Label>
            <Input
              id={id}
              autoFocus
              value={value}
              maxLength={2048}
              placeholder="https://"
              aria-invalid={error || undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => {
                setValue(event.target.value);
                setError(false);
              }}
            />
            {error && (
              <p
                id={`${id}-error`}
                className="text-destructive-foreground text-xs"
              >
                {t("whiteboardEditor:link.invalid")}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            {element?.link && (
              <Button
                type="button"
                variant="destructive-outline"
                className="sm:me-auto"
                onClick={() => {
                  c.patch([element], { link: null });
                  onOpenChange(false);
                }}
              >
                {t("whiteboardEditor:link.remove")}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {t("whiteboardEditor:actions.cancel")}
            </Button>
            <Button type="submit">{t("whiteboardEditor:actions.save")}</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
