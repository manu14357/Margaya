import type { PublicTaskListQuery } from "@/types/public-board";

// Every public board query starts with ["public-board", token], so signing
// in, continuing as a guest or signing out refreshes the whole board.

export const publicBoardKeys = {
  all: (token: string) => ["public-board", token] as const,
  board: (token: string) => ["public-board", token, "board"] as const,
  tasksAll: (token: string) => ["public-board", token, "tasks"] as const,
  tasks: (token: string, query: PublicTaskListQuery) =>
    ["public-board", token, "tasks", query] as const,
  task: (token: string, number: number) =>
    ["public-board", token, "task", number] as const,
  description: (token: string, number: number) =>
    ["public-board", token, "description", number] as const,
  comments: (token: string, number: number) =>
    ["public-board", token, "comments", number] as const,
  myRequests: (token: string) =>
    ["public-board", token, "my-requests"] as const,
};
