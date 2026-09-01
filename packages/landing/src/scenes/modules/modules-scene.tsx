"use client";

import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CirclePause,
  CircleX,
  ListFilter,
  Plus,
  SlidersHorizontal,
  Star,
  UserRound,
} from "lucide-react";
import { useMemo } from "react";
import { fill, type LandingCopy, useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import {
  Avatar,
  FilterBar,
  FilterChip,
  GroupProgressBar,
  IconRail,
  ProgressRing,
  PropertyPopover,
  ReplicaButton,
  ReplicaCard,
  ReplicaShell,
  TopBar,
  ViewChoice,
} from "../../replica";
import { ProjectCrumb } from "../planning/crumb";
import {
  MODULE_STATUSES,
  type ModuleItem,
  type ModuleStatus,
  type ModulesAction,
  type ModulesLayout,
  type ModulesState,
  moduleProgress,
  moduleScope,
  modulesReducer,
} from "./state";

type Demo = LandingCopy["demo"];

/** The module the script moves to In progress. */
export const RESTATUSED_MODULE_ID = "onboarding";

const STATUS_META: Record<ModuleStatus, { icon: LucideIcon; tone: string }> = {
  backlog: { icon: CircleDashed, tone: "text-muted-foreground" },
  planned: { icon: Circle, tone: "text-info-foreground" },
  "in-progress": { icon: CircleDot, tone: "text-warning-foreground" },
  paused: { icon: CirclePause, tone: "text-muted-foreground" },
  completed: { icon: CircleCheck, tone: "text-success-foreground" },
  cancelled: { icon: CircleX, tone: "text-destructive-foreground" },
};

function initialModules(demo: Demo): ModuleItem[] {
  const { items } = demo.modules;
  const { people } = demo;
  return [
    {
      id: "billing",
      ...items.billing,
      status: "in-progress",
      lead: people.mira.name,
      counts: { completed: 10, started: 3, unstarted: 2, backlog: 1 },
    },
    {
      id: "api",
      ...items.api,
      status: "in-progress",
      lead: people.jonas.name,
      counts: { completed: 6, started: 4, unstarted: 4, backlog: 1 },
    },
    {
      id: "onboarding",
      ...items.onboarding,
      status: "planned",
      lead: people.priya.name,
      counts: { completed: 0, started: 0, unstarted: 5, backlog: 3 },
    },
    {
      id: "search",
      ...items.search,
      status: "paused",
      lead: people.sam.name,
      counts: { completed: 3, started: 1, unstarted: 6, backlog: 2 },
    },
    {
      id: "docs",
      ...items.docs,
      status: "completed",
      lead: people.adam.name,
      counts: { completed: 12, started: 0, unstarted: 0, backlog: 0 },
    },
    {
      id: "roles",
      ...items.roles,
      status: "backlog",
      lead: null,
      counts: { completed: 0, started: 0, unstarted: 1, backlog: 3 },
    },
  ];
}

/**
 * The modules page: the list with progress rings and leads, then the
 * gallery with progress bars, where the cursor changes a module's status.
 */
export function createModulesScene(
  demo: Demo,
): DemoScene<ModulesState, ModulesAction> {
  return {
    id: "modules",
    initialState: {
      modules: initialModules(demo),
      layout: "list",
      menuFor: null,
    },
    reducer: modulesReducer,
    script: [
      step.wait(1400),
      step.click("layout-gallery", { type: "layout", layout: "gallery" }),
      step.wait(1100),
      step.click(`module-status-${RESTATUSED_MODULE_ID}`, {
        type: "openStatus",
        id: RESTATUSED_MODULE_ID,
      }),
      step.wait(450),
      step.click("option-in-progress", {
        type: "setStatus",
        id: RESTATUSED_MODULE_ID,
        status: "in-progress",
      }),
      step.wait(3200),
    ],
    render: (props) => <ModulesView {...props} />,
  };
}

function StatusGlyph({ status }: { status: ModuleStatus }) {
  const { icon: Icon, tone } = STATUS_META[status];
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", tone)} />;
}

function StatusLabel({ status }: { status: ModuleStatus }) {
  const statuses = useLandingCopy().demo.modules.statuses;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <StatusGlyph status={status} />
      <span className="truncate">{statuses[status]}</span>
    </span>
  );
}

function LeadAvatar({ lead }: { lead: string | null }) {
  if (!lead) {
    return (
      <span
        aria-hidden
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border border-dashed text-muted-foreground"
      >
        <UserRound className="size-3" />
      </span>
    );
  }
  return <Avatar name={lead} size="sm" />;
}

function ModulesView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<ModulesState, ModulesAction>) {
  const demo = useLandingCopy().demo;
  const { modules: copy, shell, planning } = demo;

  const statusControl = (module: ModuleItem, popoverClass: string) => (
    <>
      <button
        type="button"
        data-demo={`module-status-${module.id}`}
        onClick={() => dispatch({ type: "openStatus", id: module.id })}
        className="relative z-10 inline-flex h-6 max-w-36 shrink-0 cursor-pointer items-center rounded-md border border-border bg-background px-2 text-xs outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <StatusLabel status={module.status} />
      </button>
      {state.menuFor === module.id && (
        <PropertyPopover
          className={cn("absolute w-44", popoverClass)}
          options={MODULE_STATUSES.map((id) => ({
            id,
            label: copy.statuses[id],
            icon: <StatusGlyph status={id} />,
            selected: id === module.status,
          }))}
          onSelect={(id) =>
            dispatch({
              type: "setStatus",
              id: module.id,
              status: id as ModuleStatus,
            })
          }
        />
      )}
    </>
  );

  const doneOf = (module: ModuleItem) =>
    fill(planning.doneOfScope, {
      done: module.counts.completed,
      scope: moduleScope(module.counts),
    });

  return (
    <ReplicaShell
      rail={
        compact ? undefined : (
          <IconRail
            active="projects"
            user={demo.people.adam.name}
            inboxCount={3}
          />
        )
      }
    >
      <TopBar
        compact
        place={
          <ProjectCrumb project={demo.projects.website} icon={Boxes}>
            {planning.sections.modules}
          </ProjectCrumb>
        }
        actions={
          <ReplicaButton variant="primary" icon={Plus}>
            {copy.newModule}
          </ReplicaButton>
        }
      />
      <FilterBar
        trailing={
          <>
            <ViewChoice<ModulesLayout>
              label={shell.display}
              value={state.layout}
              demoPrefix="layout"
              onChange={(layout) => dispatch({ type: "layout", layout })}
              options={[
                { value: "list", label: copy.list },
                { value: "gallery", label: copy.gallery },
              ]}
            />
            {!compact && (
              <ReplicaButton icon={SlidersHorizontal}>
                {shell.display}
              </ReplicaButton>
            )}
          </>
        }
      >
        <FilterChip icon={ListFilter}>{shell.filter}</FilterChip>
      </FilterBar>
      <div className="min-h-0 flex-1 overflow-hidden">
        {state.layout === "list" ? (
          <div className="divide-y divide-border/50 border-border/50 border-b">
            {state.modules.map((module) => {
              const percent = moduleProgress(module.counts);
              return (
                <div
                  key={module.id}
                  data-demo={`module-${module.id}`}
                  className={cn(
                    "relative flex min-h-11 items-center gap-3 bg-card px-4 py-1.5",
                    state.menuFor === module.id && "z-20",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
                      {percent === 100 ? (
                        <CircleCheck
                          aria-hidden
                          className="size-4 text-success-foreground"
                        />
                      ) : (
                        <ProgressRing percent={percent} />
                      )}
                      <span className="w-8">{percent}%</span>
                    </span>
                    <span className="min-w-0 truncate font-medium text-sm">
                      {module.name}
                    </span>
                    {!compact && (
                      <span className="shrink-0 text-muted-foreground text-xs">
                        {module.dates}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {statusControl(module, "top-10 right-24")}
                    <LeadAvatar lead={module.lead} />
                    {!compact && (
                      <span className="w-16 text-muted-foreground text-xs tabular-nums">
                        {doneOf(module)}
                      </span>
                    )}
                    <Star
                      aria-hidden
                      className="size-3.5 text-muted-foreground/70"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={cn("grid gap-3 p-4", "grid-cols-2")}>
            {state.modules.map((module) => (
              <ReplicaCard
                key={module.id}
                data-demo={`module-${module.id}`}
                className={cn(
                  "gap-2 p-3 transition-[opacity,translate] duration-300 starting:translate-y-1 starting:opacity-0",
                  state.menuFor === module.id && "z-20",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate pt-0.5 font-medium text-sm">
                    {module.name}
                  </span>
                  {statusControl(module, "top-10 right-3")}
                </div>
                <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
                  <span className="tabular-nums">{doneOf(module)}</span>
                  <LeadAvatar lead={module.lead} />
                </div>
                <GroupProgressBar
                  counts={module.counts}
                  className="flex-none"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-muted-foreground text-xs">
                    {module.dates}
                  </span>
                  <Star
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground/70"
                  />
                </div>
              </ReplicaCard>
            ))}
          </div>
        )}
      </div>
    </ReplicaShell>
  );
}

/** The modules demo, ready to drop into a section. */
export function ModulesDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createModulesScene(copy.demo), [copy.demo]);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.modules.caption}
      description={copy.scenes.modules.description}
      size={{ width: 800, height: 560 }}
      compactSize={{ width: 520, height: 640 }}
      className={className}
    />
  );
}
