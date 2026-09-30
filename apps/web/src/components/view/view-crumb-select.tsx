import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown, Layers, Lock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGetViews } from "@/hooks/queries/view/use-get-views";
import { viewPath } from "@/lib/view/entity-link";
import type { SavedView } from "@/types/view";

type ViewCrumbSelectProps = {
  workspaceId: string;
  projectId: string;
  view?: SavedView;
};

/** "Views / {view} ▾": back to the list, or switch to another view. */
export default function ViewCrumbSelect({
  workspaceId,
  projectId,
  view,
}: ViewCrumbSelectProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const { data: views = [] } = useGetViews({ workspaceId, projectId });
  const needle = search.trim().toLowerCase();
  const matching = views.filter(
    (candidate) => !needle || candidate.name.toLowerCase().includes(needle),
  );

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Link
        to="/dashboard/workspace/$workspaceId/project/$projectId/views"
        params={{ workspaceId, projectId }}
        className="rounded-md px-2 py-1 text-foreground/80 text-xs hover:bg-accent hover:text-foreground"
      >
        {t("views:nav.title")}
      </Link>
      <span className="text-foreground/30 text-xs">/</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              className="h-7 max-w-56 justify-between gap-2 px-2 text-foreground text-xs"
            />
          }
        >
          <span className="truncate">{view?.name ?? "…"}</span>
          <ChevronsUpDown className="size-3 text-foreground/70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-96 w-72" align="start">
          <div className="p-1">
            <input
              aria-label={t("views:list.searchPlaceholder")}
              className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring"
              placeholder={t("views:list.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
          {matching.map((candidate) => (
            <DropdownMenuItem
              key={candidate.id}
              disabled={candidate.id === view?.id}
              className="h-8 gap-2 text-sm"
              onClick={() =>
                navigate({
                  to: viewPath(workspaceId, candidate.id, candidate.projectId),
                })
              }
            >
              <Layers className="size-3.5 text-muted-foreground" />
              <span className="truncate">{candidate.name}</span>
              {candidate.isLocked && (
                <Lock className="ml-auto size-3 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {view?.isLocked && (
        <Tooltip>
          <TooltipTrigger
            render={<span className="inline-flex text-muted-foreground" />}
          >
            <Lock
              role="img"
              aria-label={t("views:lock.locked")}
              className="size-3.5"
            />
          </TooltipTrigger>
          <TooltipContent>
            {view.lockedBy
              ? t("views:lock.lockedBy", { name: view.lockedBy.name })
              : t("views:lock.lockedHint")}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
