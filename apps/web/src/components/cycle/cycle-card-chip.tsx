import { IterationCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCycleLookup } from "@/hooks/queries/cycle/use-cycle-lookup";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import { useCycleScope } from "./cycle-scope-context";

const MAX_NAME_LENGTH = 14;

export function truncateCycleName(name: string): string {
  return name.length > MAX_NAME_LENGTH
    ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…`
    : name;
}

/** A task card's or row's cycle chip; hidden on the cycle's own board. */
export default function CycleCardChip({
  task,
  projectId,
}: TaskPropertySlotProps["cardChip"]) {
  const scope = useCycleScope();
  if (!task.cycleId || scope) return null;
  return <CycleChip projectId={projectId} cycleId={task.cycleId} />;
}

function CycleChip({
  projectId,
  cycleId,
}: {
  projectId: string;
  cycleId: string;
}) {
  const { t } = useTranslation();
  const { cycle } = useCycleLookup(projectId, cycleId);
  if (!cycle) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="h-5.5 gap-1 px-2 py-1 font-normal text-[10px] text-muted-foreground"
          >
            <IterationCw className="size-3" />
            <span>{truncateCycleName(cycle.name)}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          {t("cycles:chip.tooltip", { name: cycle.name })}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
