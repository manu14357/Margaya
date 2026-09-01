"use client";

import {
  BookOpen,
  CalendarDays,
  ChartColumn,
  ChartLine,
  Check,
  ChevronDown,
  FolderKanban,
  Globe,
  Server,
  Smartphone,
  Table2,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo } from "react";
import { fill, type LandingCopy, useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import {
  ContextPanel,
  FilterBar,
  FilterChip,
  IconRail,
  LABEL_COLORS,
  PanelRow,
  PanelSection,
  ProjectTile,
  ReplicaShell,
  TopBar,
  ViewTabs,
} from "../../replica";
import {
  ANALYTICS_DATA,
  type AnalyticsAction,
  type AnalyticsDimension,
  type AnalyticsState,
  analyticsReducer,
  DIMENSIONS,
  initialAnalyticsState,
  totalOf,
} from "./state";

type Demo = LandingCopy["demo"];

/** Analytics: the custom chart regrouped from priority to status. */
export function createAnalyticsScene(): DemoScene<
  AnalyticsState,
  AnalyticsAction
> {
  return {
    id: "analytics",
    initialState: initialAnalyticsState,
    reducer: analyticsReducer,
    script: [
      step.wait(900),
      step.click("xaxis-select", { type: "openMenu" }),
      step.wait(450),
      step.click("xaxis-option-status", { type: "select", xAxis: "status" }),
      step.set({ type: "grow" }),
      step.wait(3400),
    ],
    render: (props) => <AnalyticsView {...props} />,
  };
}

/** Bar fills: status and priority use the app's semantic tones. */
const TONES: Record<string, string> = {
  backlog: "bg-muted-foreground/35",
  todo: "bg-info",
  inProgress: "bg-warning",
  inReview: "bg-warning/55",
  done: "bg-success",
  urgent: "bg-destructive",
  high: "bg-warning",
  medium: "bg-warning/55",
  low: "bg-info",
  none: "bg-muted-foreground/35",
};

function categoryLabel(
  demo: Demo,
  xAxis: AnalyticsDimension,
  key: string,
): string {
  switch (xAxis) {
    case "status":
      return demo.statuses[key as keyof Demo["statuses"]];
    case "priority":
      return demo.priorities[key as keyof Demo["priorities"]];
    case "assignee":
      return demo.people[key as keyof Demo["people"]].name;
    case "label":
      return demo.labels[key as keyof Demo["labels"]];
  }
}

function barStyle(xAxis: AnalyticsDimension, key: string) {
  if (xAxis === "label") {
    return {
      className: "",
      color:
        LABEL_COLORS[
          (
            {
              feature: "purple",
              bug: "red",
              design: "pink",
              docs: "teal",
            } as const
          )[key as "feature" | "bug" | "design" | "docs"]
        ],
    };
  }
  if (xAxis === "assignee") return { className: "bg-primary/80" };
  return { className: TONES[key] ?? "bg-primary/80" };
}

const SCALE_MAX = 20;
const TICKS = [20, 15, 10, 5, 0];

function SelectTrigger({
  children,
  target,
  onClick,
  open = false,
}: {
  children: ReactNode;
  target?: string;
  onClick?: () => void;
  open?: boolean;
}) {
  return (
    <button
      type="button"
      data-demo={target}
      aria-expanded={open}
      onClick={onClick}
      className={cn(
        "flex h-7 w-32 cursor-pointer items-center justify-between gap-1 rounded-md border bg-background px-2 text-left text-foreground text-xs shadow-xs/5 dark:bg-input/32",
        open ? "border-ring ring-2 ring-ring/20" : "border-input",
      )}
    >
      <span className="truncate">{children}</span>
      <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
    </button>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      {children}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-semibold text-2xl text-foreground tabular-nums">
        {value}
      </p>
    </div>
  );
}

function AnalyticsView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<AnalyticsState, AnalyticsAction>) {
  const demo = useLandingCopy().demo;
  const copy = demo.analytics;
  const data = ANALYTICS_DATA[state.xAxis];

  // A visitor's pick regrows the bars too, a frame after they render flat.
  useEffect(() => {
    if (state.grown) return;
    const frame = requestAnimationFrame(() => dispatch({ type: "grow" }));
    return () => cancelAnimationFrame(frame);
  }, [state.grown, dispatch]);

  const tabs = (Object.keys(copy.tabs) as (keyof typeof copy.tabs)[]).map(
    (id) => ({ id, label: copy.tabs[id] }),
  );

  return (
    <ReplicaShell
      rail={
        compact ? undefined : (
          <IconRail active="analytics" user={demo.people.adam.name} />
        )
      }
      panel={
        compact ? undefined : (
          <ContextPanel title={copy.title}>
            <PanelSection>
              <PanelRow
                label={copy.workspaceAnalytics}
                icon={ChartLine}
                active
              />
            </PanelSection>
            <PanelSection label={demo.shell.panel.projects}>
              <PanelRow
                label={demo.projects.website}
                leading={<ProjectTile icon={Globe} />}
              />
              <PanelRow
                label={demo.projects.mobile}
                leading={<ProjectTile icon={Smartphone} />}
              />
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
            <ChartLine aria-hidden className="size-4 text-muted-foreground" />
            <span className="truncate">{copy.workspaceAnalytics}</span>
          </>
        }
      />
      <ViewTabs tabs={tabs} active="tasks" />
      <FilterBar>
        <FilterChip icon={FolderKanban}>{copy.allProjects}</FilterChip>
        <FilterChip icon={CalendarDays}>{copy.period}</FilterChip>
      </FilterBar>

      <div className="min-h-0 flex-1 overflow-hidden bg-muted/20 p-4 dark:bg-transparent">
        <div className="grid grid-cols-3 gap-3">
          <Kpi label={copy.kpis.open} value={29} />
          <Kpi label={copy.kpis.completed} value={17} />
          <Kpi label={copy.kpis.overdue} value={3} />
        </div>

        <section className="mt-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-medium text-foreground text-sm">
                {copy.chartTitle}
              </h2>
              <p className="mt-0.5 text-muted-foreground text-xs">
                {copy.chartSubtitle}
              </p>
            </div>
            <div className="flex overflow-hidden rounded-md border border-input">
              <span
                title={copy.chart}
                className="flex size-7 items-center justify-center bg-accent text-foreground"
              >
                <ChartColumn aria-hidden className="size-3.5" />
              </span>
              <span
                title={copy.table}
                className="flex size-7 items-center justify-center border-input border-l text-muted-foreground"
              >
                <Table2 aria-hidden className="size-3.5" />
              </span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Labeled label={copy.xAxis}>
              <div className="relative">
                <SelectTrigger
                  target="xaxis-select"
                  open={state.menuOpen}
                  onClick={() =>
                    dispatch({
                      type: state.menuOpen ? "closeMenu" : "openMenu",
                    })
                  }
                >
                  {copy.dimensions[state.xAxis]}
                </SelectTrigger>
                {state.menuOpen && (
                  <div
                    role="listbox"
                    className="absolute top-full left-0 z-20 mt-1 w-40 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                  >
                    {DIMENSIONS.map((dimension) => (
                      <button
                        key={dimension}
                        type="button"
                        role="option"
                        aria-selected={dimension === state.xAxis}
                        data-demo={`xaxis-option-${dimension}`}
                        onClick={() =>
                          dispatch({ type: "select", xAxis: dimension })
                        }
                        className="flex w-full cursor-pointer items-center justify-between rounded-[5px] px-2 py-1.5 text-left text-xs hover:bg-accent"
                      >
                        {copy.dimensions[dimension]}
                        {dimension === state.xAxis && (
                          <Check aria-hidden className="size-3.5" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Labeled>
            <Labeled label={copy.metric}>
              <SelectTrigger>{copy.tasks}</SelectTrigger>
            </Labeled>
            {!compact && (
              <Labeled label={copy.segment}>
                <SelectTrigger>{copy.none}</SelectTrigger>
              </Labeled>
            )}
          </div>

          {/* The chart: gridlines and ticks, then one bar per category. */}
          <div className="mt-5 flex gap-2">
            <div className="flex h-56 flex-col justify-between pb-6 text-right text-[11px] text-muted-foreground tabular-nums">
              {TICKS.map((tick) => (
                <span key={tick} className="-translate-y-1/2 leading-none">
                  {tick}
                </span>
              ))}
            </div>
            <div className="relative h-56 flex-1">
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between"
              >
                {TICKS.map((tick) => (
                  <span key={tick} className="h-px w-full bg-border/70" />
                ))}
              </div>
              <div
                role="img"
                aria-label={fill(copy.summary, {
                  count: totalOf(state.xAxis),
                  dimension: copy.dimensions[state.xAxis],
                })}
                className="absolute inset-0 flex items-end justify-around gap-4 px-4"
              >
                {data.map((entry, index) => {
                  const style = barStyle(state.xAxis, entry.key);
                  return (
                    <div
                      key={`${state.xAxis}-${entry.key}`}
                      className="flex h-full min-w-0 max-w-24 flex-1 flex-col items-center justify-end"
                    >
                      <div className="flex w-full flex-1 flex-col items-center justify-end">
                        <span
                          className={cn(
                            "mb-1 font-medium text-[11px] text-foreground tabular-nums transition-opacity duration-300",
                            state.grown ? "opacity-100" : "opacity-0",
                          )}
                          style={{
                            transitionDelay: `${300 + index * 70}ms`,
                          }}
                        >
                          {entry.value}
                        </span>
                        <div
                          className={cn(
                            "w-full origin-bottom rounded-t-[4px] transition-transform duration-700 ease-out",
                            style.className,
                          )}
                          style={{
                            height: `${(entry.value / SCALE_MAX) * 100}%`,
                            transform: `scaleY(${state.grown ? 1 : 0})`,
                            transitionDelay: `${index * 70}ms`,
                            backgroundColor: style.color,
                          }}
                        />
                      </div>
                      <span className="mt-1.5 h-4.5 w-full truncate text-center text-[11px] text-muted-foreground">
                        {categoryLabel(demo, state.xAxis, entry.key)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </div>
    </ReplicaShell>
  );
}

/** The chart-builder demo. */
export function AnalyticsDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createAnalyticsScene(), []);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.analytics.caption}
      description={copy.scenes.analytics.description}
      size={{ width: 1280, height: 640 }}
      compactSize={{ width: 640, height: 780 }}
      className={className}
    />
  );
}
