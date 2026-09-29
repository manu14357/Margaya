import { ChevronsUpDown, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilterOptionRow } from "@/components/task-filters/filter-primitives";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import icons from "@/constants/project-icons";

export type ExportProjectOption = {
  id: string;
  name: string;
  icon: string | null;
  archivedAt: string | null;
};

type ExportProjectSelectProps = {
  id?: string;
  /** Every project of the workspace, in sidebar order. */
  projects: readonly ExportProjectOption[];
  /** Picked ids; empty means every non-archived project. */
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
};

function ProjectIcon({ icon }: { icon: string | null }) {
  const Icon = icons[(icon ?? "Layout") as keyof typeof icons] ?? icons.Layout;
  return <Icon className="text-muted-foreground" />;
}

/** The export form's project picker: Active and Archived groups. */
export function ExportProjectSelect({
  id,
  projects,
  selected,
  onChange,
  disabled,
}: ExportProjectSelectProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();

  const groups = useMemo(() => {
    const visible = needle
      ? projects.filter((project) =>
          project.name.toLowerCase().includes(needle),
        )
      : projects;
    return [
      {
        key: "active",
        label: t("settings:workspaceExports.form.activeGroup"),
        items: visible.filter((project) => !project.archivedAt),
      },
      {
        key: "archived",
        label: t("settings:workspaceExports.form.archivedGroup"),
        items: visible.filter((project) => project.archivedAt),
      },
    ].filter((group) => group.items.length > 0);
  }, [needle, projects, t]);

  const selectedNames = projects
    .filter((project) => selected.includes(project.id))
    .map((project) => project.name);
  const triggerLabel =
    selectedNames.length === 0
      ? t("settings:workspaceExports.form.allProjects")
      : selectedNames.length <= 2
        ? selectedNames.join(", ")
        : t("settings:workspaceExports.form.projectsCount", {
            count: selectedNames.length,
          });

  const toggle = (projectId: string) => {
    onChange(
      selected.includes(projectId)
        ? selected.filter((value) => value !== projectId)
        : [...selected, projectId],
    );
  };

  return (
    <Popover onOpenChange={(open) => !open && setSearch("")}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className="w-full justify-between font-normal"
          />
        }
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-1">
        <div className="relative mb-1">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 size-3.5 text-muted-foreground" />
          <input
            aria-label={t("settings:workspaceExports.form.searchProjects")}
            className="h-7 w-full rounded-md border border-input bg-background pr-2 pl-7 text-xs outline-none placeholder:text-muted-foreground/72 focus:border-ring"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder={t("settings:workspaceExports.form.searchProjects")}
            value={search}
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.key} className="grid grid-cols-1 gap-0.5 pb-1">
              <p className="px-2 pt-1.5 pb-1 font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wide">
                {group.label}
              </p>
              {group.items.map((project) => (
                <FilterOptionRow
                  key={project.id}
                  checked={selected.includes(project.id)}
                  icon={<ProjectIcon icon={project.icon} />}
                  label={project.name}
                  onClick={() => toggle(project.id)}
                />
              ))}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="px-2 py-1.5 text-muted-foreground text-xs">
              {t("settings:workspaceExports.form.noProjectsFound")}
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
            {t("settings:workspaceExports.form.clearProjects")}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default ExportProjectSelect;
