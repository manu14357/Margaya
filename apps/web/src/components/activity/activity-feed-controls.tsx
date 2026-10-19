import { ListFilter } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useActiveWorkspaceAgentIds } from "@/components/ai/agents/use-agent-ids";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  ACTIVITY_FILTERS,
  ACTIVITY_SORTS,
  type ActivityFilter,
  type ActivitySort,
  useUserPreferencesStore,
} from "@/store/user-preferences";

const FILTER_KEYS: Record<ActivityFilter, string> = {
  all: "activity:feed.all",
  comments: "activity:feed.comments",
  updates: "activity:feed.updates",
  agents: "ai:agents.activityFilter",
};

const SORT_KEYS: Record<ActivitySort, string> = {
  newest: "activity:feed.newest",
  oldest: "activity:feed.oldest",
};

function isFilter(value: unknown): value is ActivityFilter {
  return ACTIVITY_FILTERS.some((filter) => filter === value);
}

function isSort(value: unknown): value is ActivitySort {
  return ACTIVITY_SORTS.some((sort) => sort === value);
}

/**
 * The activity feed's "Show" and "Order" choices, remembered per browser.
 * The trigger names the current filter when it is not "All".
 */
export default function ActivityFeedControls() {
  const { t } = useTranslation();
  const filter = useUserPreferencesStore((state) => state.activityFilter);
  const sort = useUserPreferencesStore((state) => state.activitySort);
  const setFilter = useUserPreferencesStore((state) => state.setActivityFilter);
  const setSort = useUserPreferencesStore((state) => state.setActivitySort);
  const hasAgents = useActiveWorkspaceAgentIds().size > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-muted-foreground text-xs"
            aria-label={t("activity:feed.label")}
            title={t("activity:feed.label")}
          />
        }
      >
        <ListFilter className="size-3.5" />
        <span>
          {filter === "all" ? t(SORT_KEYS[sort]) : t(FILTER_KEYS[filter])}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("activity:feed.show")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={filter}
            onValueChange={(value) => {
              if (isFilter(value)) setFilter(value);
            }}
          >
            {ACTIVITY_FILTERS.filter(
              // "Agents" only in workspaces that have agents.
              (value) => value !== "agents" || hasAgents || filter === value,
            ).map((value) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {t(FILTER_KEYS[value])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("activity:feed.order")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sort}
            onValueChange={(value) => {
              if (isSort(value)) setSort(value);
            }}
          >
            {ACTIVITY_SORTS.map((value) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {t(SORT_KEYS[value])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
