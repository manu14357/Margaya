import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  type AdminFeedbackFilters,
  getAdminFeedbackSummary,
  listAdminFeedback,
} from "@/fetchers/feedback/admin-feedback";
import {
  getFeedbackConfig,
  listOwnFeedback,
} from "@/fetchers/feedback/feedback";

// One prefix for everything feedback: ["feedback"] refreshes it all, and the
// FEEDBACK_UPDATED user-socket hint refreshes the admin views.
export const feedbackKeys = {
  all: ["feedback"] as const,
  config: () => ["feedback", "config"] as const,
  mine: () => ["feedback", "mine"] as const,
  admin: () => ["feedback", "admin"] as const,
  adminSummary: (query: { format?: string; kind?: string; days: number }) =>
    ["feedback", "admin", "summary", query] as const,
  adminList: (filters: AdminFeedbackFilters) =>
    ["feedback", "admin", "list", filters] as const,
};

/** Whether Send feedback and the survey are on; refreshed every few minutes. */
export function useFeedbackConfig(enabled = true) {
  return useQuery({
    queryKey: feedbackKeys.config(),
    queryFn: getFeedbackConfig,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useOwnFeedback(enabled = true) {
  return useQuery({
    queryKey: feedbackKeys.mine(),
    queryFn: listOwnFeedback,
    enabled,
  });
}

export function useAdminFeedbackSummary(query: {
  format?: AdminFeedbackFilters["format"];
  kind?: AdminFeedbackFilters["kind"];
  days: number;
}) {
  return useQuery({
    queryKey: feedbackKeys.adminSummary(query),
    queryFn: () => getAdminFeedbackSummary(query),
    refetchOnWindowFocus: true,
  });
}

export function useAdminFeedbackList(filters: AdminFeedbackFilters) {
  return useInfiniteQuery({
    queryKey: feedbackKeys.adminList(filters),
    queryFn: ({ pageParam }) => listAdminFeedback(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
  });
}
