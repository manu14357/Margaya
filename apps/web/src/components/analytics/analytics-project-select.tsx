import { FolderKanban, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilterOptionRow } from "@/components/task-filters/filter-primitives";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import type { AnalyticsScopeProject } from "./analytics-context";
import { ProjectIcon } from "./category-label";

type AnalyticsProjectSelectProps = {
  /** The workspace's non-archived projects, in sidebar order. */
  projects: readonly AnalyticsScopeProject[];
  /** Selected ids; empty means all projects. */
  selected: readonly string[];
  onChange: (ids: string[]) => void;
};

/** Narrows workspace analytics to some projects; empty means all. */
export default function AnalyticsProjectSelect({
  projects,
  selected,
  onChange,
}: AnalyticsProjectSelectProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? projects.filter((project) =>
            project.name.toLowerCase().includes(needle),
          )
        : projects,
    [needle, projects],
  );

  const selectedNames = projects
    .filter((project) => selected.includes(project.id))
    .map((project) => project.name);
  const triggerLabel =
    selectedNames.length === 0
      ? t("analytics:header.allProjects")
      : selectedNames.length <= 2
        ? selectedNames.join(", ")
        : t("analytics:header.projectsCount", { count: selectedNames.length });

  const toggle = (id: string) => {
    const next = selected.includes(id)
      ? selected.filter((value) => value !== id)
      : [...selected, id];
    // Every project picked is the same as none: "All projects".
    onChange(next.length === projects.length ? [] : next);
  };

  return (
    <Popover onOpenChange={(open) => !open && setSearch("")}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title={t("analytics:header.selectProjects")}
            className={cn(
              "inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md border px-2.5 font-medium text-xs outline-none",
              selected.length > 0
                ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                : "border-border bg-background text-foreground hover:bg-accent/60",
            )}
          />
        }
      >
        <FolderKanban className="size-3 shrink-0" />
        <span className="truncate">{triggerLabel}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        <div className="relative mb-1">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 size-3.5 text-muted-foreground" />
          <input
            aria-label={t("analytics:header.searchProjects")}
            className="h-7 w-full rounded-md border border-input bg-background pr-2 pl-7 text-xs outline-none placeholder:text-muted-foreground/72 focus:border-ring"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder={t("analytics:header.searchProjects")}
            value={search}
          />
        </div>
        <div className="grid max-h-72 grid-cols-1 gap-0.5 overflow-y-auto">
          {visible.map((project) => (
            <FilterOptionRow
              key={project.id}
              checked={selected.includes(project.id)}
              icon={<ProjectIcon icon={project.icon} />}
              label={project.name}
              onClick={() => toggle(project.id)}
            />
          ))}
          {visible.length === 0 && (
            <p className="px-2 py-1.5 text-muted-foreground text-xs">
              {t("analytics:header.noProjectsFound")}
            </p>
          )}
        </div>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1 inline-flex h-7 w-full items-center gap-1.5 rounded-md border-border border-t px-2 text-left text-muted-foreground text-xs hover:bg-accent/60 hover:text-foreground"
          >
            <X className="size-3.5" />
            {t("analytics:header.clearSelection")}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
