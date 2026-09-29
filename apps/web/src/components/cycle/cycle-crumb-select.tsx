import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import useGetCycles from "@/hooks/queries/cycle/use-get-cycles";
import { sectionCycles } from "@/lib/cycle/order";
import type { Cycle } from "@/types/cycle";
import { CycleStatusIcon } from "./cycle-status";

type CycleCrumbSelectProps = {
  workspaceId: string;
  projectId: string;
  cycleId: string;
  cycleName?: string;
  panel?: "closed";
};

/** "Cycles / {cycle} ▾": back to the list, or switch to another cycle. */
export default function CycleCrumbSelect({
  workspaceId,
  projectId,
  cycleId,
  cycleName,
  panel,
}: CycleCrumbSelectProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: cycles = [] } = useGetCycles(projectId);
  const { active, upcoming, completed } = sectionCycles(cycles);
  const groups: Array<{ key: string; label: string; cycles: Cycle[] }> = [
    {
      key: "active",
      label: t("cycles:sections.active"),
      cycles: active ? [active] : [],
    },
    { key: "upcoming", label: t("cycles:sections.upcoming"), cycles: upcoming },
    {
      key: "completed",
      label: t("cycles:sections.completed"),
      cycles: completed,
    },
  ].filter((group) => group.cycles.length > 0);

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Link
        to="/dashboard/workspace/$workspaceId/project/$projectId/cycles"
        params={{ workspaceId, projectId }}
        className="rounded-md px-2 py-1 text-foreground/80 text-xs hover:bg-accent hover:text-foreground"
      >
        {t("cycles:nav.title")}
      </Link>
      <span className="text-foreground/30 text-xs">/</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              aria-label={t("cycles:detail.switchCycle")}
              className="h-7 max-w-56 justify-between gap-2 px-2 text-foreground text-xs"
            />
          }
        >
          <span className="truncate">{cycleName ?? "…"}</span>
          <ChevronsUpDown className="size-3 text-foreground/70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-96 w-72" align="start">
          {groups.map((group, index) => (
            <Fragment key={group.key}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
                  {group.label}
                </DropdownMenuLabel>
                {group.cycles.map((cycle) => (
                  <DropdownMenuItem
                    key={cycle.id}
                    disabled={cycle.id === cycleId}
                    className="h-8 gap-2 text-sm"
                    onClick={() =>
                      navigate({
                        to: "/dashboard/workspace/$workspaceId/project/$projectId/cycles/$cycleId",
                        params: { workspaceId, projectId, cycleId: cycle.id },
                        search: panel ? { panel } : {},
                      })
                    }
                  >
                    <CycleStatusIcon cycle={cycle} />
                    <span className="truncate">{cycle.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
