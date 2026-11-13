import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveAs } from "file-saver";
import {
  type AdminFeedbackFilters,
  deleteAdminFeedback,
  exportAdminFeedback,
  purgeAdminFeedback,
} from "@/fetchers/feedback/admin-feedback";
import {
  deleteOwnFeedback,
  dismissFeedbackSurvey,
  type SubmitFeedbackInput,
  setFeedbackSurveyPreference,
  submitFeedback,
} from "@/fetchers/feedback/feedback";
import { feedbackKeys } from "@/hooks/queries/feedback/use-feedback";
import { withReauth } from "@/lib/reauth";

// None of these touch tasks: skip the global task-query refresh.
const meta = { refreshTaskQueries: false };

export function useSubmitFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitFeedbackInput) => submitFeedback(input),
    meta,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.mine() });
      // An admin sending feedback sees it at once; others get the hint.
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.admin() });
    },
  });
}

export function useDismissFeedbackSurvey() {
  return useMutation({ mutationFn: dismissFeedbackSurvey, meta });
}

export function useSetFeedbackSurveyPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (optedOut: boolean) => setFeedbackSurveyPreference(optedOut),
    meta,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.config() });
    },
  });
}

export function useDeleteOwnFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteOwnFeedback,
    meta,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.mine() });
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.admin() });
    },
  });
}

/** Saves a JSON copy of what this account has sent. */
export function downloadOwnFeedback(items: unknown[]) {
  const blob = new Blob([JSON.stringify({ feedback: items }, null, 2)], {
    type: "application/json",
  });
  saveAs(blob, "my-feedback.json");
}

export function useExportAdminFeedback() {
  return useMutation({
    mutationFn: async (filters: AdminFeedbackFilters) => {
      const file = await exportAdminFeedback(filters);
      saveAs(file.blob, file.fileName);
      return file.fileName;
    },
    meta,
  });
}

export function useDeleteAdminFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => withReauth(() => deleteAdminFeedback(id)),
    meta,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.admin() });
    },
  });
}

export function usePurgeAdminFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (olderThanDays: number) =>
      withReauth(() => purgeAdminFeedback(olderThanDays)),
    meta,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.admin() });
    },
  });
}
