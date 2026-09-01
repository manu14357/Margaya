"use client";

import {
  BookOpen,
  Globe,
  IterationCw,
  ListFilter,
  Plus,
  Server,
  Share2,
  SlidersHorizontal,
  Smartphone,
} from "lucide-react";
import type { ReactNode } from "react";
import { useLandingCopy } from "../../copy";
import {
  ContextPanel,
  FilterBar,
  FilterChip,
  IconRail,
  PanelCount,
  PanelRow,
  PanelSection,
  ProjectTile,
  type ProjectView,
  ProjectViewTabs,
  ReplicaButton,
  ReplicaShell,
  TopBar,
} from "../../replica";

/**
 * The Website project page every view scene sits in: rail, projects panel,
 * top bar, the project's layout tabs and the lens bar. `children` fills the
 * page under the lens bar.
 */
export function ViewFrame({
  view,
  compact,
  taskCount,
  toolbar,
  filters,
  children,
}: {
  view: ProjectView;
  compact: boolean;
  /** The Website row's count in the panel. */
  taskCount: number;
  /** Right side of the lens bar (before Display). */
  toolbar?: ReactNode;
  /** Extra chips after Filter and the cycle chip. */
  filters?: ReactNode;
  children: ReactNode;
}) {
  const demo = useLandingCopy().demo;
  const { shell } = demo;
  return (
    <ReplicaShell
      rail={
        compact ? undefined : (
          <IconRail
            active="projects"
            user={demo.people.adam.name}
            inboxCount={2}
          />
        )
      }
      panel={
        compact ? undefined : (
          <ContextPanel title={shell.panel.projects}>
            <PanelSection label={shell.panel.favorites}>
              <PanelRow
                label={demo.projects.website}
                leading={<ProjectTile icon={Globe} />}
                active
                trailing={<PanelCount count={taskCount} />}
              />
              <PanelRow
                label={demo.projects.mobile}
                leading={<ProjectTile icon={Smartphone} />}
                trailing={<PanelCount count={9} />}
              />
            </PanelSection>
            <PanelSection label={shell.panel.projects}>
              <PanelRow
                label={demo.projects.platform}
                leading={<ProjectTile icon={Server} />}
              />
              <PanelRow
                label={demo.projects.handbook}
                leading={<ProjectTile icon={BookOpen} />}
              />
            </PanelSection>
          </ContextPanel>
        )
      }
    >
      <TopBar
        compact={compact}
        place={
          <>
            <ProjectTile icon={Globe} className="size-5" />
            <span className="truncate">{demo.projects.website}</span>
          </>
        }
        actions={
          <ReplicaButton variant="primary" icon={Plus}>
            {shell.newTask}
          </ReplicaButton>
        }
      />
      <ProjectViewTabs
        active={view}
        trailing={
          compact ? undefined : (
            <ReplicaButton variant="ghost" icon={Share2}>
              {shell.share}
            </ReplicaButton>
          )
        }
      />
      <FilterBar
        trailing={
          <>
            {toolbar}
            {!compact && (
              <ReplicaButton icon={SlidersHorizontal}>
                {shell.display}
              </ReplicaButton>
            )}
          </>
        }
      >
        <FilterChip icon={ListFilter}>{shell.filter}</FilterChip>
        {!compact && (
          <FilterChip icon={IterationCw}>{demo.views.cycle}</FilterChip>
        )}
        {filters}
      </FilterBar>
      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
    </ReplicaShell>
  );
}
