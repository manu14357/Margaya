import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const WHITEBOARD_TITLE_MAX_LENGTH = 200;

type RenameWhiteboardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onRename: (title: string) => void;
};

export default function RenameWhiteboardDialog({
  open,
  onOpenChange,
  title,
  onRename,
}: RenameWhiteboardDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(title);

  useEffect(() => {
    if (open) setValue(title);
  }, [open, title]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = value.trim();
    if (next !== title.trim()) onRename(next);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("whiteboards:dialogs.rename.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 px-6 pb-2">
            <Label htmlFor="whiteboard-rename-input">
              {t("whiteboards:dialogs.rename.label")}
            </Label>
            <Input
              id="whiteboard-rename-input"
              value={value}
              maxLength={WHITEBOARD_TITLE_MAX_LENGTH}
              placeholder={t("whiteboards:list.untitled")}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("whiteboards:dialogs.cancel")}
            </Button>
            <Button type="submit">
              {t("whiteboards:dialogs.rename.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
