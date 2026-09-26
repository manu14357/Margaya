import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import type { AutomationRule } from "@/types/project-automation";

export type PendingAutomationChange = {
  rule: AutomationRule;
  /** Turning the rule on, rather than lowering its months. */
  turningOn: boolean;
  months: number;
  count: number;
  capped: boolean;
  columnName?: string;
  apply: () => void;
};

const COPY = {
  archive: {
    titleOn: "settings:projectAutomations.confirmArchive.titleOn",
    titleChange: "settings:projectAutomations.confirmArchive.titleChange",
    description: "settings:projectAutomations.confirmArchive.description",
  },
  close: {
    titleOn: "settings:projectAutomations.confirmClose.titleOn",
    titleChange: "settings:projectAutomations.confirmClose.titleChange",
    description: "settings:projectAutomations.confirmClose.description",
  },
} as const;

type AutomationConfirmDialogProps = {
  pending: PendingAutomationChange | null;
  onClose: () => void;
};

/** Before a rule takes more tasks: how many match now (B11 §1.7). */
export default function AutomationConfirmDialog({
  pending,
  onClose,
}: AutomationConfirmDialogProps) {
  const { t } = useTranslation();
  const copy = COPY[pending?.rule ?? "archive"];
  const count = pending
    ? `${formatNumber(pending.count)}${pending.capped ? "+" : ""}`
    : "";
  const period = pending
    ? t("settings:projectAutomations.months", { count: pending.months })
    : "";

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(pending?.turningOn ? copy.titleOn : copy.titleChange)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(copy.description, {
              tasks: count,
              period,
              column: pending?.columnName ?? "",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              pending?.apply();
              onClose();
            }}
          >
            {pending?.turningOn
              ? t("settings:projectAutomations.confirm.turnOn")
              : t("settings:projectAutomations.confirm.update")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
