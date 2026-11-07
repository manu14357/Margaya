import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateCustomField from "@/fetchers/custom-field/update-custom-field";

function useUpdateCustomField(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateCustomField,
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ["custom-fields", projectId],
        (existing: Array<typeof updated> | undefined) =>
          existing?.map((field) => (field.id === updated.id ? updated : field)),
      );
      // A renamed option also rewrites task values, saved view filters,
      // automation conditions and drafts, so everything on screen refreshes.
      void queryClient.invalidateQueries();
    },
  });
}

export default useUpdateCustomField;
