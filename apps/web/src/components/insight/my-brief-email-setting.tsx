import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import getUserPreferences from "@/fetchers/user/get-user-preferences";
import updateUserPreferences from "@/fetchers/user/update-user-preferences";
import { userPreferencesQueryKey } from "@/hooks/use-preferences-sync";
import { toast } from "@/lib/toast";

/**
 * My brief in the email digest (#18): an opt-in user preference, off by
 * default. The digest then adds your blocked tasks and changes on tasks you
 * follow; it is sent only with a daily or weekly digest.
 */
export default function MyBriefEmailSetting() {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: userPreferencesQueryKey,
    queryFn: getUserPreferences,
    staleTime: 60_000,
  });
  const save = useMutation({
    mutationFn: (enabled: boolean) =>
      updateUserPreferences({ myBriefEmail: enabled }),
    onSuccess: (saved) =>
      queryClient.setQueryData(userPreferencesQueryKey, saved),
    onError: () => toast.error(t("insight:myBrief.emailError")),
  });
  const enabled =
    (save.isPending ? save.variables : data?.preferences?.myBriefEmail) ===
    true;

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border bg-card p-4">
      <div className="space-y-1">
        <Label htmlFor={id}>{t("insight:myBrief.emailTitle")}</Label>
        <p className="text-muted-foreground text-xs">
          {t("insight:myBrief.emailDescription")}
        </p>
      </div>
      <Switch
        id={id}
        checked={enabled}
        disabled={isPending || save.isPending}
        onCheckedChange={(checked) => save.mutate(checked)}
      />
    </div>
  );
}
