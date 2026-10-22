"use client";

import {
  BookOpen,
  CalendarDays,
  Globe,
  IterationCw,
  ListFilter,
  Plus,
  Server,
  Share2,
  SlidersHorizontal,
  Smartphone,
} from "lucide-react";
import { useMemo } from "react";
import { fill, type LandingCopy, useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import {
  Avatar,
  AvatarStack,
  Board,
  BoardColumn,
  CaptureBar,
  ContextPanel,
  FilterBar,
  FilterChip,
  IconRail,
  LabelChip,
  PanelCount,
  PanelRow,
  PanelSection,
  PriorityIcon,
  ProjectTile,
  ProjectViewTabs,
  PropertyValue,
  ReplicaButton,
  ReplicaShell,
  type SheetProperty,
  StatusIcon,
  TaskCard,
  TaskSheet,
  TokenChip,
  TopBar,
} from "../../replica";
import {
  type CaptureVocabulary,
  createHeroReducer,
  type HeroAction,
  type HeroState,
  type HeroStatus,
  type HeroTask,
  NEW_TASK_ID,
  parseCapture,
} from "./state";

type Demo = LandingCopy["demo"];

const COLUMNS: HeroStatus[] = ["todo", "inProgress", "done"];

function vocabularyFrom(demo: Demo): CaptureVocabulary {
  const priorities = (["low", "medium", "high", "urgent"] as const).flatMap(
    (priority) => [
      { word: priority, priority },
      { word: demo.priorities[priority].toLowerCase(), priority },
    ],
  );
  return {
    people: Object.values(demo.people),
    priorities,
    labels: [
      { name: demo.labels.bug, color: "red" },
      { name: demo.labels.feature, color: "purple" },
      { name: demo.labels.design, color: "pink" },
      { name: demo.labels.docs, color: "teal" },
    ],
  };
}

function initialTasks(demo: Demo): HeroTask[] {
  const { tasks } = demo.hero;
  const { people, labels } = demo;
  return [
    {
      id: "onboarding",
      number: 18,
      title: tasks.onboarding,
      status: "todo",
      priority: "medium",
      labels: [{ name: labels.docs, color: "teal" }],
      assignees: [people.mira.name],
    },
    {
      id: "contrast",
      number: 21,
      title: tasks.contrast,
      status: "todo",
      priority: "low",
      labels: [{ name: labels.design, color: "pink" }],
      assignees: [people.priya.name],
    },
    {
      id: "export",
      number: 15,
      title: tasks.export,
      status: "inProgress",
      priority: "high",
      labels: [{ name: labels.feature, color: "purple" }],
      assignees: [people.jonas.name, people.adam.name],
    },
    {
      id: "cache",
      number: 19,
      title: tasks.cache,
      status: "inProgress",
      priority: "medium",
      labels: [],
      assignees: [people.sam.name],
    },
    {
      id: "darkMode",
      number: 12,
      title: tasks.darkMode,
      status: "done",
      priority: "low",
      labels: [{ name: labels.design, color: "pink" }],
      assignees: [people.mira.name],
    },
  ];
}

/**
 * The hero scene: type a task with tokens into the To do capture bar,
 * Enter, drag the new card to In progress, open it in the sheet.
 */
export function createHeroScene(demo: Demo): DemoScene<HeroState, HeroAction> {
  const vocabulary = vocabularyFrom(demo);
  return {
    id: "hero",
    initialState: {
      tasks: initialTasks(demo),
      capture: { active: false, text: "" },
      openTaskId: null,
    },
    reducer: createHeroReducer(vocabulary, 24),
    script: [
      step.wait(600),
      step.click("capture-input", { type: "focus" }),
      step.type("capture-input", demo.hero.typed, (value) => ({
        type: "input",
        value,
      })),
      step.wait(500),
      step.key("Enter", { type: "submit" }),
      step.wait(450),
      step.drag(
        `card-${NEW_TASK_ID}`,
        "column-inProgress",
        { type: "move", id: NEW_TASK_ID, status: "inProgress" },
        { anchor: { y: 0.12 } },
      ),
      step.wait(400),
      step.click(`card-${NEW_TASK_ID}`, { type: "open", id: NEW_TASK_ID }),
      step.wait(3400),
    ],
    render: (props) => <HeroView {...props} vocabulary={vocabulary} />,
  };
}

function HeroView({
  state,
  dispatch,
  compact,
  vocabulary,
}: SceneRenderProps<HeroState, HeroAction> & {
  vocabulary: CaptureVocabulary;
}) {
  const demo = useLandingCopy().demo;
  const { shell, hero, statuses, priorities, sheet } = demo;
  const taskKey = (task: HeroTask) => `${hero.projectKey}-${task.number}`;
  const parsed = parseCapture(state.capture.text, vocabulary);
  const open = state.tasks.find((task) => task.id === state.openTaskId);
  const columns = compact ? COLUMNS.slice(0, 2) : COLUMNS;

  const preview =
    parsed.tokens.length > 0 ? (
      <>
        <span className="me-0.5 text-muted-foreground text-xs">
          {fill(demo.capture.preview, { column: statuses.todo })}
        </span>
        {parsed.tokens.map((token) => (
          <TokenChip
            key={token.raw}
            kind={token.kind}
            priority={token.kind === "priority" ? token.priority : undefined}
            color={token.kind === "label" ? token.color : undefined}
          >
            {token.kind === "priority"
              ? priorities[token.priority]
              : token.name}
          </TokenChip>
        ))}
      </>
    ) : (
      <span className="text-muted-foreground text-xs">{demo.capture.hint}</span>
    );

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
      panel={
        compact ? undefined : (
          <ContextPanel title={shell.panel.projects}>
            <PanelSection label={shell.panel.favorites}>
              <PanelRow
                label={demo.projects.website}
                leading={<ProjectTile icon={Globe} seed="web" />}
                active
                trailing={<PanelCount count={state.tasks.length} />}
              />
              <PanelRow
                label={demo.projects.mobile}
                leading={<ProjectTile icon={Smartphone} seed="app" />}
                trailing={<PanelCount count={9} />}
              />
            </PanelSection>
            <PanelSection label={shell.panel.projects}>
              <PanelRow
                label={demo.projects.platform}
                leading={<ProjectTile icon={Server} seed="server" />}
              />
              <PanelRow
                label={demo.projects.handbook}
                leading={<ProjectTile icon={BookOpen} seed="handbook" />}
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
            <ProjectTile icon={Globe} seed="web" className="size-5" />
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
        active="board"
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
          <ReplicaButton icon={SlidersHorizontal}>
            {shell.display}
          </ReplicaButton>
        }
      >
        <FilterChip icon={ListFilter}>{shell.filter}</FilterChip>
        <FilterChip icon={IterationCw}>{hero.cycle}</FilterChip>
      </FilterBar>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Board>
          {columns.map((status) => {
            const tasks = state.tasks.filter((task) => task.status === status);
            return (
              <BoardColumn
                key={status}
                data-demo={`column-${status}`}
                status={status}
                title={statuses[status]}
                count={tasks.length}
                footer={
                  status === "todo" ? (
                    <CaptureBar
                      data-demo="capture-input"
                      value={state.capture.text}
                      active={state.capture.active}
                      placeholder={demo.capture.placeholder}
                      ariaLabel={demo.capture.placeholder}
                      preview={preview}
                      onFocus={() => dispatch({ type: "focus" })}
                      onChange={(value) => dispatch({ type: "input", value })}
                      onSubmit={() => dispatch({ type: "submit" })}
                    />
                  ) : undefined
                }
              >
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    data-demo={`card-${task.id}`}
                    taskKey={taskKey(task)}
                    title={task.title}
                    labels={task.labels}
                    priority={task.priority}
                    assignees={task.assignees}
                    selected={task.id === state.openTaskId}
                    onClick={() => dispatch({ type: "open", id: task.id })}
                  />
                ))}
              </BoardColumn>
            );
          })}
        </Board>
        <TaskSheet
          open={!!open}
          taskKey={open ? taskKey(open) : ""}
          status={{
            id: open?.status ?? "todo",
            label: statuses[open?.status ?? "todo"],
          }}
          title={open?.title ?? ""}
          description={
            open?.id === NEW_TASK_ID ? hero.newTaskDescription : undefined
          }
          propertiesLabel={sheet.properties}
          closeLabel={sheet.close}
          onClose={() => dispatch({ type: "close" })}
          properties={open ? sheetProperties(open, demo) : []}
          footer={
            open?.id === NEW_TASK_ID ? (
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <Avatar name={demo.people.adam.name} size="xs" />
                {hero.createdActivity}
              </div>
            ) : undefined
          }
          className={compact ? "w-full" : undefined}
        />
      </div>
    </ReplicaShell>
  );
}

function sheetProperties(task: HeroTask, demo: Demo): SheetProperty[] {
  const { sheet, statuses, priorities, hero } = demo;
  const isNew = task.id === NEW_TASK_ID;
  const none = <PropertyValue muted>{sheet.empty}</PropertyValue>;
  return [
    {
      id: "status",
      label: sheet.status,
      value: (
        <PropertyValue
          icon={
            <StatusIcon status={task.status} colored className="size-3.5" />
          }
        >
          {statuses[task.status]}
        </PropertyValue>
      ),
    },
    {
      id: "priority",
      label: sheet.priority,
      value: (
        <PropertyValue icon={<PriorityIcon priority={task.priority} />}>
          {priorities[task.priority]}
        </PropertyValue>
      ),
    },
    {
      id: "assignees",
      label: sheet.assignees,
      value: (
        <PropertyValue
          icon={<AvatarStack names={task.assignees} max={3} size="xs" />}
        >
          {task.assignees.join(", ")}
        </PropertyValue>
      ),
    },
    {
      id: "labels",
      label: sheet.labels,
      value:
        task.labels.length > 0 ? (
          <span className="flex flex-wrap gap-1 ps-1.5">
            {task.labels.map((label) => (
              <LabelChip
                key={label.name}
                name={label.name}
                color={label.color}
              />
            ))}
          </span>
        ) : (
          none
        ),
    },
    {
      id: "dueDate",
      label: sheet.dueDate,
      value: isNew ? (
        <PropertyValue
          icon={
            <CalendarDays
              aria-hidden
              className="size-3.5 text-muted-foreground"
            />
          }
        >
          {hero.dueDate}
        </PropertyValue>
      ) : (
        none
      ),
    },
    {
      id: "cycle",
      label: sheet.cycle,
      value: (
        <PropertyValue
          icon={
            <IterationCw
              aria-hidden
              className="size-3.5 text-muted-foreground"
            />
          }
        >
          {hero.cycle}
        </PropertyValue>
      ),
    },
    {
      id: "estimate",
      label: sheet.estimate,
      value: isNew ? <PropertyValue>{hero.estimate}</PropertyValue> : none,
    },
  ];
}

/** The hero demo, ready to drop into a section. */
export function HeroDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createHeroScene(copy.demo), [copy.demo]);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.hero.caption}
      description={copy.scenes.hero.description}
      size={{ width: 1280, height: 800 }}
      compactSize={{ width: 640, height: 820 }}
      className={className}
    />
  );
}
