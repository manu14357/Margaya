import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import PlanningSearchDialog from "@/components/planning/planning-search-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTransferCycleTasks } from "@/hooks/mutations/cycle/use-transfer-cycle-tasks";
import useGetCycles from "@/hooks/queries/cycle/use-get-cycles";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatCycleRange } from "@/lib/cycle/dates";
import { searchCycles } from "@/lib/cycle/order";
import { isAssignableCycle } from "@/lib/cycle/status";
import { toast } from "@/lib/toast";
import type { Cycle } from "@/types/cycle";
import CycleFormDialog from "./cycle-form-dialog";
import { CycleStatusBadge, CycleStatusIcon } from "./cycle-status";

type TransferTasksDialogProps = {
  cycle: Pick<Cycle, "id" | "projectId" | "pending">;
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Moves a completed cycle's unfinished tasks into another cycle. */
export default function TransferTasksDialog({
  cycle,
  workspaceId,
  open,
  onOpenChange,
}: TransferTasksDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const { canCreateCycles } = useWorkspacePermission();
  const { data: cycles = [], isLoading } = useGetCycles(
    cycle.projectId,
    "all",
    {
      enabled: open,
    },
  );
  const transfer = useTransferCycleTasks();

  const targets = useMemo(
    () =>
      cycles.filter(
        (candidate) =>
          candidate.id !== cycle.id && isAssignableCycle(candidate),
      ),
    [cycles, cycle.id],
  );
  const visible = searchCycles(targets, query);

  const handleTransfer = (target: Cycle) => {
    transfer.mutate(
      {
        cycleId: cycle.id,
        projectId: cycle.projectId,
        targetCycleId: target.id,
      },
      {
        onSuccess: (result) => {
          toast.success(
            t("cycles:toast.transferred", {
              count: result.movedTaskIds.length,
              name: target.name,
            }),
          );
          setQuery("");
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(error.message || t("cycles:toast.transferError"));
        },
      },
    );
  };

  return (
    <>
      <PlanningSearchDialog
        open={open && !isCreateOpen}
        onOpenChange={onOpenChange}
        title={t("cycles:transfer.title", { count: cycle.pending })}
        description={t("cycles:transfer.description")}
        query={query}
        onQueryChange={setQuery}
        placeholder={t("cycles:transfer.searchPlaceholder")}
      >
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : targets.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-muted-foreground text-sm">
              {t("cycles:transfer.noTargets")}
            </p>
            {canCreateCycles() && (
              <Button size="sm" onClick={() => setIsCreateOpen(true)}>
                <Plus />
                {t("cycles:transfer.newCycle")}
              </Button>
            )}
          </div>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground text-sm">
            {t("cycles:transfer.noResults")}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {visible.map((target) => (
              <li key={target.id}>
                <button
                  type="button"
                  disabled={transfer.isPending}
                  onClick={() => handleTransfer(target)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-64"
                >
                  <CycleStatusIcon cycle={target} />
                  <span className="min-w-0 flex-1 truncate">{target.name}</span>
                  <span className="hidden shrink-0 text-muted-foreground text-xs sm:inline">
                    {formatCycleRange(target.startDate, target.endDate)}
                  </span>
                  <CycleStatusBadge cycle={target} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PlanningSearchDialog>

      <CycleFormDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        projectId={cycle.projectId}
        workspaceId={workspaceId}
      />
    </>
  );
}
