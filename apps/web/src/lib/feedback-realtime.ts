import type { QueryClient } from "@tanstack/react-query";

// FEEDBACK_UPDATED reaches every instance admin's user socket when someone
// sends feedback or feedback is deleted. It carries no data: the open
// Feedback page refetches its summary and list.

export function handleFeedbackUserMessage(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  message: { type?: string },
): boolean {
  if (message.type !== "FEEDBACK_UPDATED") return false;
  void queryClient.invalidateQueries({ queryKey: ["feedback", "admin"] });
  return true;
}
