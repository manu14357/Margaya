import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type CreateSamlConnectionInput,
  type CreateScimConnectionInput,
  createSamlConnection,
  createScimConnection,
  deleteSamlConnection,
  deleteScimConnection,
  rotateScimConnectionToken,
  type UpdateSamlConnectionInput,
  updateSamlConnection,
} from "@/fetchers/instance-admin/identity-connections";
import { identityConnectionKeys } from "@/hooks/queries/instance-admin/use-identity-connections";
import { instanceAdminKeys } from "@/hooks/queries/instance-admin/use-instance-admin";
import { withReauth } from "@/lib/reauth";

const NOT_ABOUT_TASKS = { refreshTaskQueries: false };

function useScimMutation<Input, Result>(
  run: (input: Input) => Promise<Result>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Input) => withReauth(() => run(input)),
    meta: NOT_ABOUT_TASKS,
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: identityConnectionKeys.scim(),
      });
      void queryClient.invalidateQueries({
        queryKey: instanceAdminKeys.auditLog(),
      });
    },
  });
}

export function useCreateScimConnection() {
  return useScimMutation((input: CreateScimConnectionInput) =>
    createScimConnection(input),
  );
}

export function useRotateScimConnectionToken() {
  return useScimMutation((id: string) => rotateScimConnectionToken(id));
}

export function useDeleteScimConnection() {
  return useScimMutation((id: string) => deleteScimConnection(id));
}

function useSamlMutation<Input, Result>(
  run: (input: Input) => Promise<Result>,
  onSuccess?: () => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Input) => withReauth(() => run(input)),
    meta: NOT_ABOUT_TASKS,
    onSuccess,
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: identityConnectionKeys.saml(),
      });
      // The sign-in screen offers SAML only while a connection exists.
      void queryClient.invalidateQueries({ queryKey: ["config"] });
      void queryClient.invalidateQueries({
        queryKey: instanceAdminKeys.auditLog(),
      });
    },
  });
}

export function useCreateSamlConnection() {
  const queryClient = useQueryClient();
  return useSamlMutation(
    (input: CreateSamlConnectionInput) => createSamlConnection(input),
    // Its addresses now belong to this connection; the next one needs new ones.
    () =>
      queryClient.removeQueries({
        queryKey: identityConnectionKeys.samlDraft(),
      }),
  );
}

export function useUpdateSamlConnection() {
  return useSamlMutation(
    ({ id, ...json }: UpdateSamlConnectionInput & { id: string }) =>
      updateSamlConnection(id, json),
  );
}

export function useDeleteSamlConnection() {
  return useSamlMutation((id: string) => deleteSamlConnection(id));
}
