import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useGetPages } from "@/hooks/queries/page/use-get-pages";
import { cn } from "@/lib/cn";
import { buildPageTree, flattenAllPages } from "@/lib/pages/build-page-tree";
import PageLogo from "./page-logo";

type PageCrumbSelectProps = {
  workspaceId: string;
  projectId: string;
  pageId: string;
  title?: string;
  logoKind?: string | null;
  logoValue?: string | null;
};

/**
 * "{page} ▾" at the start of the document bar: a searchable switcher over
 * the project's page tree. The Pages tab leads back to the list.
 */
export default function PageCrumbSelect({
  workspaceId,
  projectId,
  pageId,
  title,
  logoKind = null,
  logoValue = null,
}: PageCrumbSelectProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: pages = [] } = useGetPages(projectId);
  const untitled = t("pages:list.untitled");

  const rows = useMemo(() => {
    const active = pages.filter((page) => !page.archivedAt);
    const all = flattenAllPages(buildPageTree(active));
    const needle = query.trim().toLowerCase();
    return needle
      ? all.filter(({ page }) =>
          (page.title.trim() || untitled).toLowerCase().includes(needle),
        )
      : all;
  }, [pages, query, untitled]);

  return (
    <div className="flex min-w-0 items-center">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              className="h-7 min-w-0 max-w-72 shrink justify-between gap-1.5 px-1.5 font-medium text-[13px] text-foreground"
            />
          }
        >
          <PageLogo
            logoKind={logoKind}
            logoValue={logoValue}
            className="size-3.5"
          />
          <span className="min-w-0 truncate">{title?.trim() || untitled}</span>
          <ChevronsUpDown className="size-3 text-foreground/70" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-1">
          <div className="relative p-1">
            <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3.5 z-10 size-3.5 text-muted-foreground" />
            <Input
              size="sm"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("pages:crumb.searchPlaceholder")}
              aria-label={t("pages:crumb.searchPlaceholder")}
              className="[&_[data-slot=input]]:pl-8"
            />
          </div>
          <div className="max-h-80 overflow-y-auto">
            {rows.length === 0 ? (
              <p className="px-2 py-4 text-center text-muted-foreground text-sm">
                {t("pages:crumb.noMatches")}
              </p>
            ) : (
              rows.map(({ page, depth }) => (
                <button
                  key={page.id}
                  type="button"
                  disabled={page.id === pageId}
                  onClick={() => {
                    setOpen(false);
                    navigate({
                      to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
                      params: { workspaceId, projectId, pageId: page.id },
                    });
                  }}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-sm pe-2 text-left text-sm hover:bg-accent disabled:bg-accent/60",
                  )}
                  style={{
                    paddingInlineStart: `${0.5 + (query ? 0 : depth - 1) * 0.875}rem`,
                  }}
                >
                  <PageLogo
                    logoKind={page.logoKind}
                    logoValue={page.logoValue}
                  />
                  <span className="truncate">
                    {page.title.trim() || untitled}
                  </span>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
