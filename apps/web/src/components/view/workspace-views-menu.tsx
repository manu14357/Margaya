import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, Layers, Lock, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import type { SavedView } from "@/types/view";

type WorkspaceViewsMenuProps = {
  workspaceId: string;
  views: readonly SavedView[];
  activeId: string;
  onNewView?: () => void;
};

/** "Views ▾": every workspace view I can see, a search, and New view. */
export default function WorkspaceViewsMenu({
  workspaceId,
  views,
  activeId,
  onNewView,
}: WorkspaceViewsMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const matching = views.filter(
    (view) => !needle || view.name.toLowerCase().includes(needle),
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="ml-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-muted-foreground text-xs hover:bg-accent hover:text-foreground sm:text-sm"
          />
        }
      >
        {t("views:list.more")}
        <ChevronDown className="size-3" />
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
        {matching.length === 0 && (
          <p className="px-2 py-1.5 text-muted-foreground text-xs">
            {views.length === 0
              ? t("views:list.emptyTitle")
              : t("views:list.searchEmpty", { query: search.trim() })}
          </p>
        )}
        {matching.map((view) => (
          <DropdownMenuItem
            key={view.id}
            disabled={view.id === activeId}
            className="h-8 gap-2 text-sm"
            onClick={() =>
              navigate({
                to: "/dashboard/workspace/$workspaceId/views/$viewId",
                params: { workspaceId, viewId: view.id },
              })
            }
          >
            <Layers className="size-3.5 text-muted-foreground" />
            <span className="truncate">{view.name}</span>
            {view.isLocked && (
              <Lock className="ml-auto size-3 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        ))}
        {onNewView && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="h-8 gap-2 text-sm" onClick={onNewView}>
              <Plus className="size-3.5" />
              {t("views:list.newView")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
