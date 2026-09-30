import { useNavigate } from "@tanstack/react-router";
import { EyeOff, Layers, Lock, Plus, Users } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import FavoriteButton from "@/components/favorite/favorite-button";
import { MemberAvatar } from "@/components/task-filters/subjects/member-avatar";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useGetFavorites from "@/hooks/queries/favorite/use-get-favorites";
import { useGetViews } from "@/hooks/queries/view/use-get-views";
import { findFavorite } from "@/lib/favorites";
import { formatRelativeTime } from "@/lib/format";
import { viewPath } from "@/lib/view/entity-link";
import type { SavedView } from "@/types/view";
import ViewRowActions from "./view-row-actions";

type ViewsListProps = {
  workspaceId: string;
  /** Null lists the workspace views. */
  projectId: string | null;
  query: string;
  mine: boolean;
  onCreate?: () => void;
};

/** Favorites first, then the API's order (name, natural). */
export function sortViews<T extends { id: string }>(
  views: readonly T[],
  isFavorite: (id: string) => boolean,
): T[] {
  return [...views].sort(
    (a, b) => Number(isFavorite(b.id)) - Number(isFavorite(a.id)),
  );
}

export function AccessIcon({ view }: { view: Pick<SavedView, "access"> }) {
  const { t } = useTranslation();
  const Icon = view.access === "private" ? EyeOff : Users;
  const label =
    view.access === "private"
      ? t("views:access.privateHint")
      : t("views:access.workspaceHint");
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex text-muted-foreground" />}
      >
        <Icon role="img" aria-label={label} className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ViewRow({ view }: { view: SavedView }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const path = viewPath(view.workspaceId, view.id, view.projectId);
  return (
    <div className="group relative flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 transition-colors hover:bg-accent/40 md:px-4">
      <div className="flex min-w-0 flex-1 basis-60 items-center gap-2.5">
        <Layers className="size-4 shrink-0 text-muted-foreground" />
        <button
          type="button"
          onClick={() => navigate({ to: path })}
          className="min-w-0 truncate text-left font-medium text-sm outline-none after:absolute after:inset-0 focus-visible:underline"
        >
          {view.name}
        </button>
        {view.description && (
          <span className="hidden min-w-0 truncate text-muted-foreground text-xs md:inline">
            {view.description}
          </span>
        )}
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-3">
        <AccessIcon view={view} />
        {view.isLocked && (
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
        {view.owner && (
          <span title={view.owner.name}>
            <MemberAvatar
              name={view.owner.name}
              image={view.owner.image}
              className="size-5"
            />
          </span>
        )}
        <span className="hidden w-28 text-muted-foreground text-xs sm:inline">
          {t("views:list.updated", {
            time: formatRelativeTime(view.updatedAt),
          })}
        </span>
        <FavoriteButton
          workspaceId={view.workspaceId}
          entityType="view"
          entityId={view.id}
          placeholder={{
            name: view.name,
            projectId: view.projectId,
            ...(view.projectId ? { feature: "views" } : {}),
          }}
        />
        <ViewRowActions
          view={view}
          onDuplicated={(copy) =>
            navigate({
              to: viewPath(copy.workspaceId, copy.id, copy.projectId),
            })
          }
        />
      </div>
    </div>
  );
}

/** A project's or the workspace's saved views (B4 §6.7). */
export default function ViewsList({
  workspaceId,
  projectId,
  query,
  mine,
  onCreate,
}: ViewsListProps) {
  const { t } = useTranslation();
  const {
    data: views,
    isLoading,
    isError,
    refetch,
  } = useGetViews({
    workspaceId,
    projectId,
    mine,
  });
  const { data: favorites } = useGetFavorites({ workspaceId });

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = (views ?? []).filter(
      (view) => !needle || view.name.toLowerCase().includes(needle),
    );
    return sortViews(matching, (id) =>
      Boolean(findFavorite(favorites, "view", id)),
    );
  }, [views, favorites, query]);

  if (isLoading) {
    return (
      <div className="divide-y divide-border/60">
        {["a", "b", "c", "d", "e"].map((key) => (
          <div key={key} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="ml-auto h-3 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-muted-foreground text-sm">
          {t("views:toast.loadError")}
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t("tasks:filters.retry")}
        </Button>
      </div>
    );
  }

  if ((views ?? []).length === 0) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Layers />
          </EmptyMedia>
          <EmptyTitle>{t("views:list.emptyTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("views:list.emptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
        {onCreate && (
          <EmptyContent>
            <Button size="sm" onClick={onCreate} className="gap-1">
              <Plus className="size-3.5" />
              {t("views:list.newView")}
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  }

  if (visible.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground text-sm">
        {t("views:list.searchEmpty", { query: query.trim() })}
      </p>
    );
  }

  return (
    <div className="divide-y divide-border/60">
      {visible.map((view) => (
        <ViewRow key={view.id} view={view} />
      ))}
    </div>
  );
}
