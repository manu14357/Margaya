"use client";

import {
  ArchiveRestore,
  CircleDashed,
  Ellipsis,
  Globe,
  Search,
  Trash2,
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
  Board,
  BoardColumn,
  type LabelColor,
  type Priority,
  ProjectTile,
  ProjectViewTabs,
  ReplicaButton,
  ReplicaShell,
  type StatusId,
  TaskCard,
  TopBar,
} from "../../replica";
import { NoticeToast } from "../../replica/notice-toast";
import { SettingsFrame } from "../../replica/settings-frame";
import {
  initialTrashState,
  type TrashAction,
  type TrashItemId,
  type TrashState,
  trashReducer,
} from "./state";

type Demo = LandingCopy["demo"];

const ITEMS: Record<
  TrashItemId,
  {
    number: number;
    deletedBy: keyof Demo["people"];
    priority: Priority;
    label: { key: keyof Demo["labels"]; color: LabelColor } | null;
  }
> = {
  pricing: {
    number: 27,
    deletedBy: "sam",
    priority: "medium",
    label: { key: "design", color: "pink" },
  },
  banner: { number: 22, deletedBy: "adam", priority: "low", label: null },
  legacy: { number: 9, deletedBy: "jonas", priority: "none", label: null },
};

/** Recently deleted: restore a task, then find it back on the board. */
export function createTrashScene(): DemoScene<TrashState, TrashAction> {
  return {
    id: "trash",
    initialState: initialTrashState,
    reducer: trashReducer,
    script: [
      step.wait(900),
      step.click("restore-pricing", { type: "restore", id: "pricing" }),
      step.wait(1300),
      step.click("crumb-project", { type: "openBoard" }),
      step.wait(800),
      step.move("card-pricing", { anchor: { x: 0.7, y: 0.3 } }),
      step.wait(2600),
    ],
    render: (props) => <TrashView {...props} />,
  };
}

function TrashView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<TrashState, TrashAction>) {
  const demo = useLandingCopy().demo;
  const copy = demo.trash;
  const { hero } = demo;
  const key = (number: number) => `${hero.projectKey}-${number}`;

  const crumbs = (
    <>
      <ProjectTile icon={Globe} seed="web" className="size-5" />
      <button
        type="button"
        data-demo="crumb-project"
        onClick={() => dispatch({ type: "openBoard" })}
        className="cursor-pointer truncate rounded-sm hover:underline"
      >
        {demo.projects.website}
      </button>
      {state.view === "trash" && (
        <>
          <span aria-hidden className="text-muted-foreground">
            /
          </span>
          <span className="truncate text-muted-foreground">
            {copy.settings}
          </span>
        </>
      )}
    </>
  );

  const restoredCards = state.restored.map((id) => {
    const item = ITEMS[id];
    return (
      <TaskCard
        key={id}
        data-demo={`card-${id}`}
        taskKey={key(item.number)}
        title={copy.items[id].title}
        priority={item.priority}
        labels={
          item.label
            ? [{ name: demo.labels[item.label.key], color: item.label.color }]
            : []
        }
        assignees={[demo.people.sam.name]}
        selected={id === state.restored[0]}
      />
    );
  });

  const columns: {
    status: StatusId;
    cards: { id: string; title: string; number: number; priority: Priority }[];
  }[] = [
    {
      status: "todo",
      cards: [
        {
          id: "onboarding",
          title: hero.tasks.onboarding,
          number: 18,
          priority: "medium",
        },
        {
          id: "contrast",
          title: hero.tasks.contrast,
          number: 21,
          priority: "low",
        },
      ],
    },
    {
      status: "inProgress",
      cards: [
        {
          id: "export",
          title: hero.tasks.export,
          number: 15,
          priority: "high",
        },
        {
          id: "cache",
          title: hero.tasks.cache,
          number: 19,
          priority: "medium",
        },
      ],
    },
  ];

  return (
    <ReplicaShell>
      <TopBar compact place={crumbs} />
      {state.view === "board" ? (
        <>
          <ProjectViewTabs active="board" />
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <Board>
              {columns.slice(0, compact ? 1 : 2).map((column) => (
                <BoardColumn
                  key={column.status}
                  status={column.status}
                  title={demo.statuses[column.status]}
                  count={
                    column.cards.length +
                    (column.status === "todo" ? state.restored.length : 0)
                  }
                >
                  {column.status === "todo" && restoredCards}
                  {column.cards.map((card) => (
                    <TaskCard
                      key={card.id}
                      taskKey={key(card.number)}
                      title={card.title}
                      priority={card.priority}
                    />
                  ))}
                </BoardColumn>
              ))}
            </Board>
          </div>
        </>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <SettingsFrame
            title={copy.title}
            description={compact ? undefined : copy.subtitle}
            actions={
              <ReplicaButton icon={Trash2}>{copy.emptyTrash}</ReplicaButton>
            }
          >
            <div className="flex flex-col gap-3">
              <span className="flex h-8 items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-muted-foreground text-xs dark:bg-input/32">
                <Search aria-hidden className="size-3.5" />
                {copy.search}
              </span>
              <ul className="overflow-hidden rounded-lg border border-border bg-card">
                {state.trashed.length === 0 && (
                  <li className="px-4 py-6 text-center text-muted-foreground text-sm">
                    {copy.empty}
                  </li>
                )}
                {state.trashed.map((id) => {
                  const item = ITEMS[id];
                  const text = copy.items[id];
                  return (
                    <li
                      key={id}
                      className="flex min-h-11 items-center gap-3 border-border/50 border-b px-4 py-2 last:border-b-0"
                    >
                      <CircleDashed
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 font-mono text-muted-foreground text-xs">
                            {key(item.number)}
                          </span>
                          <span className="min-w-0 truncate font-medium text-sm">
                            {text.title}
                          </span>
                          {"detail" in text && !compact && (
                            <span className="shrink-0 text-muted-foreground text-xs">
                              {text.detail}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-muted-foreground text-xs">
                          {fill(copy.deletedBy, {
                            name: demo.people[item.deletedBy].name,
                            time: text.time,
                          })}
                          {!compact &&
                            ` · ${fill(copy.purgeOn, { date: text.purge })}`}
                        </p>
                      </div>
                      <button
                        type="button"
                        data-demo={`restore-${id}`}
                        onClick={() => dispatch({ type: "restore", id })}
                        className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 font-medium text-foreground text-xs hover:bg-accent"
                      >
                        <ArchiveRestore aria-hidden className="size-4" />
                        {copy.restore}
                      </button>
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground">
                        <Ellipsis aria-hidden className="size-4" />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </SettingsFrame>
          <NoticeToast open={state.toast}>{copy.restored}</NoticeToast>
        </div>
      )}
    </ReplicaShell>
  );
}

/** The trash-restore demo. */
export function TrashDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createTrashScene(), []);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.trash.caption}
      description={copy.scenes.trash.description}
      size={{ width: 760, height: 560 }}
      compactSize={{ width: 480, height: 600 }}
      compactBelow={420}
      className={className}
    />
  );
}
