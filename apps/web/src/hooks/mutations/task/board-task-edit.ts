import type { QueryClient } from "@tanstack/react-query";
import {
  type BoardEdit,
  type BoardTaskPatch,
  startBoardEdit,
} from "@/lib/board-cache";

export type BoardEditContext = { boardEdit?: BoardEdit };

type EditTarget = {
  projectId: string;
  taskId: string;
  patch: BoardTaskPatch;
};

/**
 * Mutation callbacks that show a one-task edit on the cached board at once,
 * replace it with the server's copy when saved and undo it when the request
 * fails; either way the board reloads once, batched with other edits.
 */
export function boardTaskEdit<TData, TVariables>(
  queryClient: QueryClient,
  target: (variables: TVariables) => EditTarget,
) {
  return {
    onMutate: (variables: TVariables): BoardEditContext => {
      const { projectId, taskId, patch } = target(variables);
      return {
        boardEdit: startBoardEdit(queryClient, projectId, taskId, patch),
      };
    },
    onSaved: (data: TData, context: BoardEditContext | undefined) => {
      context?.boardEdit?.saved(data);
    },
    onFailed: (context: BoardEditContext | undefined) => {
      context?.boardEdit?.failed();
    },
  };
}
