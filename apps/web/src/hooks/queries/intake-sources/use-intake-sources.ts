import { useQuery } from "@tanstack/react-query";
import {
  getIntakeEmailSettings,
  getIntakeFormSettings,
  getPublicIntakeForm,
} from "@/fetchers/intake-sources/intake-sources";

// Intake sources (#8). Settings change only through this page's own
// mutations, which write the answer into these keys.

export const intakeSourceKeys = {
  all: (projectId: string) => ["intake-sources", projectId] as const,
  email: (projectId: string) => ["intake-sources", projectId, "email"] as const,
  form: (projectId: string) => ["intake-sources", projectId, "form"] as const,
  publicForm: (token: string) => ["public-intake-form", token] as const,
};

export function useIntakeEmailSettings(projectId: string, enabled = true) {
  return useQuery({
    queryKey: intakeSourceKeys.email(projectId),
    queryFn: ({ signal }) => getIntakeEmailSettings(projectId, signal),
    enabled: enabled && Boolean(projectId),
  });
}

export function useIntakeFormSettings(projectId: string, enabled = true) {
  return useQuery({
    queryKey: intakeSourceKeys.form(projectId),
    queryFn: ({ signal }) => getIntakeFormSettings(projectId, signal),
    enabled: enabled && Boolean(projectId),
  });
}

/** The public form; a 404 is final, so it isn't retried. */
export function usePublicIntakeForm(token: string) {
  return useQuery({
    queryKey: intakeSourceKeys.publicForm(token),
    queryFn: ({ signal }) => getPublicIntakeForm(token, signal),
    enabled: Boolean(token),
    retry: false,
  });
}
