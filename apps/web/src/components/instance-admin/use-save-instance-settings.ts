import { useTranslation } from "react-i18next";
import { useUpdateInstanceSettings } from "@/hooks/mutations/instance-admin/use-instance-admin-mutations";
import { toast } from "@/lib/toast";
import type { InstanceSettingsPatch } from "@/types/instance-admin";

/**
 * Saves a settings patch with the standard toasts. Server messages (locks,
 * the lockout guard, validation) are shown as they come. Resolves to whether
 * the save succeeded.
 */
export function useSaveInstanceSettings() {
  const { t } = useTranslation();
  const mutation = useUpdateInstanceSettings();

  const save = async (
    values: InstanceSettingsPatch,
    successMessage?: string,
  ): Promise<boolean> => {
    if (Object.keys(values).length === 0) return true;
    try {
      await mutation.mutateAsync(values);
      toast.success(successMessage ?? t("instanceAdmin:saved"));
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("instanceAdmin:saveError"),
      );
      return false;
    }
  };

  return { save, isPending: mutation.isPending };
}
