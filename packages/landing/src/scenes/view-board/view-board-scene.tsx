"use client";

import { useMemo } from "react";
import { useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { Board, BoardColumn, type StatusId, TaskCard } from "../../replica";
import {
  type Demo,
  dueTone,
  formatDay,
  taskKeyOf,
  VIEW_STAGE_COMPACT,
  VIEW_STAGE_SIZE,
  viewTasks,
  WORKFLOW,
} from "../views-shared/data";
import { ViewFrame } from "../views-shared/frame";
import {
  type BoardViewAction,
  type BoardViewState,
  boardViewReducer,
} from "./state";

/** The board layout: a card is dragged from In progress to In review. */
export function createBoardViewScene(
  demo: Demo,
): DemoScene<BoardViewState, BoardViewAction> {
  return {
    id: "viewBoard",
    initialState: { tasks: viewTasks(demo) },
    reducer: boardViewReducer,
    script: [
      step.wait(700),
      step.drag(
        "card-tokens",
        "column-inReview",
        { type: "move", id: "tokens", status: "inReview" },
        { anchor: { y: 0.18 } },
      ),
      step.wait(2200),
    ],
    render: (props) => <BoardView {...props} />,
  };
}

const DRAG_TYPE = "text/x-margaya-task";

function BoardView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<BoardViewState, BoardViewAction>) {
  const demo = useLandingCopy().demo;
  const columns: StatusId[] = compact ? ["inProgress", "inReview"] : WORKFLOW;
  return (
    <ViewFrame view="board" compact={compact} taskCount={state.tasks.length}>
      <Board>
        {columns.map((status) => {
          const tasks = state.tasks.filter((task) => task.status === status);
          return (
            // A drop target by hand, once the visitor takes over. `contents`
            // keeps the column's own layout; events still bubble through it.
            // biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only drop zone; the cards stay usable without it.
            <div
              key={status}
              className="contents"
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(DRAG_TYPE)) {
                  event.preventDefault();
                }
              }}
              onDrop={(event) => {
                const id = event.dataTransfer.getData(DRAG_TYPE);
                if (id) {
                  event.preventDefault();
                  dispatch({ type: "move", id, status });
                }
              }}
            >
              <BoardColumn
                data-demo={`column-${status}`}
                status={status}
                title={demo.statuses[status]}
                count={tasks.length}
              >
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    data-demo={`card-${task.id}`}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(DRAG_TYPE, task.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    className="cursor-grab"
                    taskKey={taskKeyOf(demo, task)}
                    title={task.title}
                    labels={task.labels}
                    priority={task.priority}
                    assignees={task.assignees}
                    due={{
                      label: formatDay(demo, task.end),
                      tone: dueTone(task),
                    }}
                  />
                ))}
              </BoardColumn>
            </div>
          );
        })}
      </Board>
    </ViewFrame>
  );
}

/** The board scene, ready to drop into a page. */
export function BoardViewDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createBoardViewScene(copy.demo), [copy.demo]);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.viewBoard.caption}
      description={copy.scenes.viewBoard.description}
      size={VIEW_STAGE_SIZE}
      compactSize={VIEW_STAGE_COMPACT}
      className={className}
    />
  );
}
