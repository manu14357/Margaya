import { useMutation } from "@tanstack/react-query";
import {
  brainstormWhiteboard,
  groupWhiteboardNotes,
  summarizeWhiteboard,
} from "@/fetchers/ai/whiteboard";

// Asking for a proposal changes nothing on the server, so there is no cache
// to update: the board changes only when the person accepts, through the
// board's realtime document.

export function useWhiteboardBrainstorm() {
  return useMutation({ mutationFn: brainstormWhiteboard });
}

export function useWhiteboardGroup() {
  return useMutation({ mutationFn: groupWhiteboardNotes });
}

export function useWhiteboardSummarize() {
  return useMutation({ mutationFn: summarizeWhiteboard });
}
