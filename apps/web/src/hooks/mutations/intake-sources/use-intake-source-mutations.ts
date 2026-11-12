import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type IntakeEmailSettings,
  type IntakeEmailSettingsPatch,
  type IntakeFormSettings,
  type IntakeFormSettingsPatch,
  type PublicIntakeFormSubmission,
  rotateIntakeEmailAddress,
  rotateIntakeFormLink,
  submitPublicIntakeForm,
  testIntakeEmailMailbox,
  updateIntakeEmailSettings,
  updateIntakeFormSettings,
} from "@/fetchers/intake-sources/intake-sources";
import { intakeSourceKeys } from "@/hooks/queries/intake-sources/use-intake-sources";

// None of these change tasks; the answers replace the cached settings.
const meta = { refreshTaskQueries: false };

export function useIntakeEmailMutations(projectId: string) {
  const queryClient = useQueryClient();
  const onSuccess = (settings: IntakeEmailSettings) =>
    queryClient.setQueryData(intakeSourceKeys.email(projectId), settings);

  const update = useMutation({
    mutationFn: (patch: IntakeEmailSettingsPatch) =>
      updateIntakeEmailSettings(projectId, patch),
    onSuccess,
    meta,
  });
  const rotate = useMutation({
    mutationFn: () => rotateIntakeEmailAddress(projectId),
    onSuccess,
    meta,
  });
  const test = useMutation({
    mutationFn: () => testIntakeEmailMailbox(projectId),
    meta,
  });
  return { update, rotate, test };
}

export function useIntakeFormMutations(projectId: string) {
  const queryClient = useQueryClient();
  const onSuccess = (settings: IntakeFormSettings) =>
    queryClient.setQueryData(intakeSourceKeys.form(projectId), settings);

  const update = useMutation({
    mutationFn: (patch: IntakeFormSettingsPatch) =>
      updateIntakeFormSettings(projectId, patch),
    onSuccess,
    meta,
  });
  const rotate = useMutation({
    mutationFn: () => rotateIntakeFormLink(projectId),
    onSuccess,
    meta,
  });
  return { update, rotate };
}

export function useSubmitPublicIntakeForm(token: string) {
  return useMutation({
    mutationFn: (submission: PublicIntakeFormSubmission) =>
      submitPublicIntakeForm(token, submission),
    meta,
  });
}
