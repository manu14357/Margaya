import {
  CalendarDays,
  CalendarRange,
  Rows3,
  Sheet,
  SquareKanban,
  SquircleDashed,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type ViewTab, ViewTabs } from "@/components/common/view-tabs";
import { shortcuts } from "@/constants/shortcuts";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import {
  type ProjectSection,
  type ProjectSectionId,
  shouldShowSectionStrip,
} from "@/lib/project-sections";

export const PROJECT_LAYOUTS = [
  "backlog",
  "board",
  "list",
  "spreadsheet",
  "calendar",
  "gantt",
] as const;

export type ProjectLayoutView = (typeof PROJECT_LAYOUTS)[number];

const LAYOUT_ICONS = {
  backlog: SquircleDashed,
  board: SquareKanban,
  list: Rows3,
  spreadsheet: Sheet,
  calendar: CalendarRange,
  gantt: CalendarDays,
} as const;

const LAYOUT_LABEL_KEYS: Record<ProjectLayoutView, string> = {
  backlog: "navigation:shell.backlog",
  board: "tasks:view.board",
  list: "tasks:view.list",
  spreadsheet: "tasks:view.spreadsheet",
  calendar: "tasks:calendar.title",
  gantt: "tasks:view.gantt",
};

export type ProjectViewTabsProps = {
  projectId: string;
  workspaceId: string;
  /** The project's visible sections (Tasks first), from useProjectSections. */
  sections: readonly ProjectSection[];
  activeSection: ProjectSectionId;
  /** The selected layout, or null when none is (e.g. project archives). */
  activeView: ProjectLayoutView | null;
  onSelectView: (view: ProjectLayoutView) => void;
  onSelectSection: (section: ProjectSection) => void;
  trailing?: ReactNode;
};

/**
 * A project's tab row: the task layouts (Backlog, Board, List, Spreadsheet,
 * Calendar, Gantt), then the sections turned on for it (Cycles, Modules,
 * Views, Pages, Intake, Analytics). Registers the `g` section shortcuts.
 */
export function ProjectViewTabs({
  sections,
  activeSection,
  activeView,
  onSelectView,
  onSelectSection,
  trailing,
}: ProjectViewTabsProps) {
  const { t } = useTranslation();
  const hasSections = shouldShowSectionStrip(sections);

  const sectionShortcuts: Record<string, () => void> = {};
  if (hasSections) {
    for (const section of sections) {
      if (section.shortcutKey) {
        sectionShortcuts[section.shortcutKey] = () => onSelectSection(section);
      }
    }
  }

  useRegisterShortcuts({
    sequentialShortcuts: hasSections
      ? { [shortcuts.section.prefix]: sectionShortcuts }
      : {},
  });

  const layoutTabs: ViewTab[] = PROJECT_LAYOUTS.map((view) => ({
    value: `view:${view}`,
    label: t(LAYOUT_LABEL_KEYS[view]),
    icon: LAYOUT_ICONS[view],
    onSelect: () => onSelectView(view),
  }));

  // Section counts (the intake queue) show once, on the context panel's
  // section entry (nav-projects.tsx); the tabs stay label-only.
  const sectionTabs: ViewTab[] = sections
    .filter((section) => section.id !== "tasks")
    .map((section, index) => ({
      value: `section:${section.id}`,
      label: t(section.labelKey),
      icon: section.icon,
      separated: index === 0,
      onSelect: () => onSelectSection(section),
    }));

  const value =
    activeSection !== "tasks"
      ? `section:${activeSection}`
      : activeView
        ? `view:${activeView}`
        : null;

  return (
    <ViewTabs
      label={t("navigation:projectNav.label")}
      tabs={[...layoutTabs, ...sectionTabs]}
      value={value}
      trailing={trailing}
    />
  );
}
