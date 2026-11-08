import { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type ConnectionConfirmDialogProps<Target> = {
  /** Open while there is something to confirm. */
  target: Target | null;
  title: (target: Target) => string;
  description: string;
  confirmLabel: string;
  onConfirm: (target: Target) => void;
  onClose: () => void;
};

/** Asks before a change that cuts an identity provider off. */
export function ConnectionConfirmDialog<Target>({
  target,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: ConnectionConfirmDialogProps<Target>) {
  const { t } = useTranslation();
  // Keeps its words while it animates closed.
  const last = useRef(target);
  if (target !== null) last.current = target;
  const shown = last.current;

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {shown !== null ? title(shown) : null}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="sm" />}>
            {t("common:actions.cancel")}
          </AlertDialogClose>
          <AlertDialogClose
            render={
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (shown !== null) onConfirm(shown);
                }}
              />
            }
          >
            {confirmLabel}
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
