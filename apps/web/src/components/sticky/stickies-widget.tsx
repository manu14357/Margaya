import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import WidgetSection, {
  WidgetEmpty,
  WidgetError,
} from "@/components/home/widget-section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import useGetStickies, {
  STICKY_WIDGET_SIZE,
} from "@/hooks/queries/sticky/use-get-stickies";
import { flattenStickies } from "@/lib/sticky-cache";
import StickyCard from "./sticky-card";
import StickySearch, { isSearchShortcut } from "./sticky-search";
import { useAddSticky } from "./use-add-sticky";

const GRID = "grid grid-cols-1 items-start gap-3 sm:grid-cols-2 md:grid-cols-3";

/** The first stickies on Home. Reordering happens on the Stickies page. */
export default function StickiesWidget({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [searchSignal, setSearchSignal] = useState(0);
  const { data, isLoading, isError, refetch } = useGetStickies({
    workspaceId,
    q: query,
    limit: STICKY_WIDGET_SIZE,
  });
  const { add, isPending } = useAddSticky(workspaceId);
  const stickies = flattenStickies(data).slice(0, STICKY_WIDGET_SIZE);

  const handleAdd = () => {
    setQuery("");
    add();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: "/" opens the search while focus is in the widget
    <div
      onKeyDown={(event) => {
        if (!isSearchShortcut(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setSearchSignal((current) => current + 1);
      }}
    >
      <WidgetSection
        title={t("home:widgets.stickies")}
        actions={
          <>
            <StickySearch
              query={query}
              onQueryChange={setQuery}
              openSignal={searchSignal}
            />
            <Button
              variant="ghost"
              size="xs"
              onClick={handleAdd}
              disabled={isPending}
            >
              {isPending ? <Spinner /> : <Plus />}
              {t("stickies:add")}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              render={
                <Link
                  to="/dashboard/workspace/$workspaceId/stickies"
                  params={{ workspaceId }}
                />
              }
            >
              {t("stickies:viewAll")}
            </Button>
          </>
        }
      >
        {isLoading ? (
          <div className={GRID}>
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-40 rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <WidgetError
            message={t("stickies:loadError")}
            retryLabel={t("stickies:retry")}
            onRetry={() => void refetch()}
          />
        ) : stickies.length === 0 ? (
          query ? (
            <WidgetEmpty>
              <span>{t("stickies:search.noResults", { query })}</span>
              <Button
                variant="ghost"
                size="xs"
                className="ms-2"
                onClick={() => setQuery("")}
              >
                {t("stickies:search.clear")}
              </Button>
            </WidgetEmpty>
          ) : (
            <WidgetEmpty>{t("stickies:empty.description")}</WidgetEmpty>
          )
        ) : (
          <div className={GRID}>
            {stickies.map((sticky) => (
              <StickyCard
                key={sticky.id}
                sticky={sticky}
                workspaceId={workspaceId}
              />
            ))}
          </div>
        )}
      </WidgetSection>
    </div>
  );
}
