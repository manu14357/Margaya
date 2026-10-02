import { useNavigate } from "@tanstack/react-router";
import { SquircleDashed } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useTriageIntakeItem } from "@/hooks/mutations/intake/use-triage-intake-item";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { getColumnIcon } from "@/lib/column";
import { getEntryColumn, withoutTriage } from "@/lib/column-groups";
import { formatIntakeKey } from "@/lib/intake";
import { toast } from "@/lib/toast";
import type { IntakeItem } from "@/types/intake";

const BACKLOG = "planned";

type AcceptIntakeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: IntakeItem;
  workspaceId: string;
  onAccepted?: (item: IntakeItem) => void;
};

/**
 * "Accept WEB-42": the backlog or a board column, defaulting to the entry
 * column (the first not-started one), else the backlog.
 */
export default function AcceptIntakeDialog({
  open,
  onOpenChange,
  item,
  workspaceId,
  onAccepted,
}: AcceptIntakeDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useGetColumns(item.projectId);
  const triage = useTriageIntakeItem();
  const columns = useMemo(
    () =>
      withoutTriage(data ?? [])
        .map((column, index) => ({ column, index }))
        .sort(
          (a, b) =>
            (a.column.position ?? a.index) - (b.column.position ?? b.index),
        )
        .map(({ column }) => column),
    [data],
  );
  const defaultStatus = getEntryColumn(columns)?.slug ?? BACKLOG;
  const [status, setStatus] = useState(defaultStatus);

  // Each opening starts from the default, once the columns are known.
  useEffect(() => {
    if (open) setStatus(defaultStatus);
  }, [open, defaultStatus]);

  const key = formatIntakeKey(item.task.key);
  const selected = columns.find((column) => column.slug === status);

  const handleAccept = () => {
    triage.mutate(
      { id: item.id, projectId: item.projectId, action: "accept", status },
      {
        onSuccess: (accepted) => {
          onOpenChange(false);
          onAccepted?.(accepted);
          const column = accepted.task.columnName;
          toast.success(
            column
              ? t("intake:accept.toast", { key, column })
              : t("intake:accept.toastBacklog", { key }),
            {
              action: {
                label: t("intake:detail.openTask"),
                onClick: () =>
                  navigate({
                    to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
                    params: {
                      workspaceId,
                      projectId: accepted.task.projectId,
                      taskId: accepted.taskId,
                    },
                  }),
              },
            },
          );
        },
        onError: (error) =>
          toast.error(error.message || t("intake:accept.error")),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("intake:accept.title", { key })}</DialogTitle>
          <DialogDescription>
            {t("intake:accept.description")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-2">
          <span className="font-medium text-muted-foreground text-xs">
            {t("intake:accept.columnLabel")}
          </span>
          <Select
            value={status}
            onValueChange={(value) => setStatus(String(value))}
            disabled={isLoading}
          >
            <SelectTrigger aria-label={t("intake:accept.columnLabel")}>
              <SelectValue>
                <span className="flex items-center gap-2">
                  {selected ? (
                    getColumnIcon(
                      selected.slug,
                      selected.isFinal,
                      selected.icon,
                      selected.group,
                    )
                  ) : (
                    <SquircleDashed className="size-4 text-muted-foreground" />
                  )}
                  {selected?.name ?? t("intake:accept.backlog")}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BACKLOG}>
                <span className="flex items-center gap-2">
                  <SquircleDashed className="size-4 text-muted-foreground" />
                  {t("intake:accept.backlog")}
                </span>
              </SelectItem>
              {columns.map((column) => (
                <SelectItem key={column.id} value={column.slug}>
                  <span className="flex items-center gap-2">
                    {getColumnIcon(
                      column.slug,
                      column.isFinal,
                      column.icon,
                      column.group,
                    )}
                    {column.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isLoading && columns.length === 0 && (
            <p className="text-muted-foreground text-xs">
              {t("intake:accept.noColumns")}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={triage.isPending}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleAccept}
            disabled={triage.isPending || isLoading}
          >
            {triage.isPending && <Spinner className="size-3.5" />}
            {t("intake:accept.submit")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
