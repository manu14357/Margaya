import { CircleDot, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import useGetCycleProgress from "@/hooks/queries/cycle/use-get-cycle-progress";
import type { Cycle } from "@/types/cycle";
import {
  CycleBurndownCard,
  CycleProgressCard,
  CycleStatsCard,
} from "./active-cycle-cards";
import CycleRow from "./cycle-row";

type ActiveCyclePanelProps = {
  cycle: Cycle | null;
  projectId: string;
  workspaceId: string;
  onCreate?: () => void;
};

/** The running cycle at a glance, or a quiet note when none runs. */
export default function ActiveCyclePanel({
  cycle,
  projectId,
  workspaceId,
  onCreate,
}: ActiveCyclePanelProps) {
  const { t } = useTranslation();
  const { data: progress, isLoading } = useGetCycleProgress(
    projectId,
    cycle?.id,
  );

  if (!cycle) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed bg-muted/30 px-4 py-3">
        <CircleDot className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">{t("cycles:active.emptyTitle")}</p>
          <p className="text-muted-foreground text-xs">
            {t("cycles:active.emptyDescription")}
          </p>
        </div>
        {onCreate && (
          <Button variant="outline" size="xs" onClick={onCreate}>
            <Plus />
            {t("cycles:page.newCycle")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border bg-card">
        <CycleRow cycle={cycle} workspaceId={workspaceId} />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        <CycleProgressCard cycle={cycle} />
        <CycleBurndownCard
          cycle={cycle}
          progress={progress}
          isLoading={isLoading}
          workspaceId={workspaceId}
        />
        <CycleStatsCard
          cycle={cycle}
          progress={progress}
          workspaceId={workspaceId}
        />
      </div>
    </div>
  );
}
