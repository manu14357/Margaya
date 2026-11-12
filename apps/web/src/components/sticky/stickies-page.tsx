import { Lock, Plus, Search, StickyNote } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TopBarLabel } from "@/components/common/header/top-bar-label";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
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
import { Spinner } from "@/components/ui/spinner";
import { useReorderStickies } from "@/hooks/mutations/sticky/use-sticky-mutations";
import useGetStickies, {
  STICKY_PAGE_SIZE,
} from "@/hooks/queries/sticky/use-get-stickies";
import { flattenStickies, stickiesQueryKey } from "@/lib/sticky-cache";
import { toast } from "@/lib/toast";
import StickyGrid, { STICKY_PAGE_GRID } from "./sticky-grid";
import StickySearch, { isSearchShortcut } from "./sticky-search";
import { useAddSticky } from "./use-add-sticky";

type StickiesPageProps = {
  workspaceId: string;
  /** Run the create flow once after the first page loads (`new=true`). */
  createOnLoad?: boolean;
  onCreateHandled?: () => void;
};

export default function StickiesPage({
  workspaceId,
  createOnLoad = false,
  onCreateHandled,
}: StickiesPageProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [searchSignal, setSearchSignal] = useState(0);
  const {
    data,
    isLoading,
    isError,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useGetStickies({ workspaceId, q: query, limit: STICKY_PAGE_SIZE });
  const reorderStickies = useReorderStickies();
  const { add, isPending } = useAddSticky(workspaceId);

  // The dropped order shows until the cache catches up, so the drop never
  // paints the old order for a frame.
  const [droppedOrder, setDroppedOrder] = useState<string[] | null>(null);
  const loaded = useMemo(() => flattenStickies(data), [data]);
  const stickies = useMemo(() => {
    if (!droppedOrder) return loaded;
    const rank = new Map(droppedOrder.map((id, index) => [id, index]));
    return [...loaded].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [loaded, droppedOrder]);

  useEffect(() => {
    if (!droppedOrder) return;
    if (loaded.map((sticky) => sticky.id).join() === droppedOrder.join()) {
      setDroppedOrder(null);
    }
  }, [loaded, droppedOrder]);

  const handleAdd = () => {
    setQuery("");
    add();
  };

  // `new=true` (the palette's "New sticky"): once, after the first page.
  const createdOnLoad = useRef(false);
  useEffect(() => {
    if (!createOnLoad || createdOnLoad.current || isLoading || !data) return;
    createdOnLoad.current = true;
    add();
    onCreateHandled?.();
  }, [add, createOnLoad, data, isLoading, onCreateHandled]);

  const handleReorder = (orderedIds: string[]) => {
    setDroppedOrder(orderedIds);
    reorderStickies.mutate(
      {
        workspaceId,
        queryKey: stickiesQueryKey(workspaceId, "", STICKY_PAGE_SIZE),
        stickyIds: orderedIds,
      },
      {
        onError: () => {
          setDroppedOrder(null);
          toast.error(t("stickies:toast.reorderError"));
        },
      },
    );
  };

  const sentinel = useRef<HTMLDivElement>(null);
  const loadMore = useRef(fetchNextPage);
  loadMore.current = fetchNextPage;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore.current();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage]);

  const addButton = (
    <Button
      size="xs"
      className="gap-1"
      onClick={handleAdd}
      disabled={isPending}
    >
      {isPending ? <Spinner className="size-3" /> : <Plus className="size-3" />}
      <TopBarLabel>{t("stickies:add")}</TopBarLabel>
    </Button>
  );

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className={STICKY_PAGE_GRID}>
        {Array.from({ length: 8 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeletons
          <Skeleton key={index} className="h-40 rounded-lg" />
        ))}
      </div>
    );
  } else if (isError && stickies.length === 0) {
    body = (
      <Empty className="min-h-[50vh]">
        <EmptyHeader>
          <EmptyTitle>{t("stickies:loadError")}</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => void refetch()}>
            {t("stickies:retry")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  } else if (stickies.length === 0) {
    body = query ? (
      <Empty className="min-h-[50vh]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Search />
          </EmptyMedia>
          <EmptyTitle>{t("stickies:search.noResults", { query })}</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => setQuery("")}>
            {t("stickies:search.clear")}
          </Button>
        </EmptyContent>
      </Empty>
    ) : (
      <Empty className="min-h-[50vh]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <StickyNote />
          </EmptyMedia>
          <EmptyTitle>{t("stickies:empty.title")}</EmptyTitle>
          <EmptyDescription>{t("stickies:empty.description")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={handleAdd} disabled={isPending}>
            <Plus />
            {t("stickies:add")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  } else {
    body = (
      <>
        <StickyGrid
          stickies={stickies}
          workspaceId={workspaceId}
          canReorder={query === ""}
          onReorder={handleReorder}
        />
        <div ref={sentinel} aria-hidden className="h-px" />
        {isFetchingNextPage && (
          <div className={`${STICKY_PAGE_GRID} mt-3`}>
            <Skeleton className="h-40 rounded-lg" />
            <Skeleton className="h-40 rounded-lg" />
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <PageTitle title={t("stickies:pageTitle")} />
      <Layout>
        <Layout.TopBar title={t("stickies:pageTitle")} actions={addButton} />
        {/* biome-ignore lint/a11y/noStaticElementInteractions: "/" opens the search while focus is on the page */}
        <div
          className="flex min-h-0 flex-1 flex-col"
          onKeyDown={(event) => {
            if (!isSearchShortcut(event)) return;
            event.preventDefault();
            event.stopPropagation();
            setSearchSignal((current) => current + 1);
          }}
        >
          <Layout.FilterBar
            trailing={
              <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
                <Lock className="size-3.5 shrink-0" aria-hidden />
                {t("stickies:privacy")}
              </p>
            }
          >
            <StickySearch
              query={query}
              onQueryChange={setQuery}
              openSignal={searchSignal}
            />
          </Layout.FilterBar>
          <Layout.ContentArea>{body}</Layout.ContentArea>
        </div>
      </Layout>
    </>
  );
}
