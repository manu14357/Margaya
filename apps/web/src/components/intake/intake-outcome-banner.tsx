import { useTranslation } from "react-i18next";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";
import {
  effectiveIntakeStatus,
  formatIntakeKey,
  INTAKE_STATUS_META,
} from "@/lib/intake";
import { formatSnoozeDay } from "@/lib/intake-snooze";
import type { IntakeItem } from "@/types/intake";

type IntakeOutcomeBannerProps = {
  item: IntakeItem;
  canTriage: boolean;
  onOpenTask: () => void;
  onOpenDuplicate: (taskId: string) => void;
};

/** What happened to the request, by whom and when (B7 §4.2). */
export default function IntakeOutcomeBanner({
  item,
  canTriage,
  onOpenTask,
  onOpenDuplicate,
}: IntakeOutcomeBannerProps) {
  const { t } = useTranslation();
  const status = effectiveIntakeStatus(item);
  const Icon = INTAKE_STATUS_META[status].icon;
  const name = item.triagedBy?.name ?? t("common:people.someone");
  const time = item.triagedAt ? formatRelativeTime(item.triagedAt) : "";

  if (status === "pending") {
    if (canTriage) return null;
    return (
      <Alert>
        <Icon />
        <AlertTitle className="font-normal text-muted-foreground">
          {t("intake:banner.waiting")}
        </AlertTitle>
      </Alert>
    );
  }

  if (status === "snoozed") {
    return (
      <Alert variant="warning">
        <Icon />
        <AlertTitle className="font-normal">
          {t("intake:banner.snoozed", {
            date: item.snoozedUntil ? formatSnoozeDay(item.snoozedUntil) : "",
            name,
          })}
        </AlertTitle>
      </Alert>
    );
  }

  if (status === "accepted") {
    return (
      <Alert variant="success">
        <Icon />
        <AlertTitle className="font-normal">
          {item.task.columnName
            ? t("intake:banner.accepted", {
                column: item.task.columnName,
                name,
                time,
              })
            : t("intake:banner.acceptedBacklog", { name, time })}
        </AlertTitle>
        <AlertAction>
          <Button variant="outline" size="xs" onClick={onOpenTask}>
            {t("intake:detail.openTask")}
          </Button>
        </AlertAction>
      </Alert>
    );
  }

  if (status === "declined") {
    return (
      <Alert variant="error">
        <Icon />
        <AlertTitle className="flex flex-col gap-0.5 font-normal">
          <span>{t("intake:banner.declined", { name, time })}</span>
          {item.resolutionNote && (
            <span className="whitespace-pre-wrap text-muted-foreground">
              {t("intake:banner.reason", { note: item.resolutionNote })}
            </span>
          )}
        </AlertTitle>
      </Alert>
    );
  }

  const duplicateOf = item.duplicateOf;
  return (
    <Alert>
      <Icon />
      <AlertTitle className="flex flex-col gap-0.5 font-normal">
        <span>
          {duplicateOf
            ? t("intake:banner.duplicate", {
                key: formatIntakeKey(duplicateOf.key),
                name,
                time,
              })
            : t("intake:banner.duplicateDeleted", { name, time })}
        </span>
        {item.resolutionNote && (
          <span className="whitespace-pre-wrap text-muted-foreground">
            {t("intake:banner.reason", { note: item.resolutionNote })}
          </span>
        )}
      </AlertTitle>
      {duplicateOf && (
        <AlertAction>
          <Button
            variant="outline"
            size="xs"
            onClick={() => onOpenDuplicate(duplicateOf.taskId)}
          >
            {formatIntakeKey(duplicateOf.key)}
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}
