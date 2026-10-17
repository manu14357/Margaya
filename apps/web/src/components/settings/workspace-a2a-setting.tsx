import { useTranslation } from "react-i18next";
import { SettingsRow } from "@/components/settings-layout";
import { Switch } from "@/components/ui/switch";
import useUpdateWorkspaceSettings from "@/hooks/mutations/workspace/use-update-workspace-settings";
import useWorkspaceSettings from "@/hooks/queries/workspace/use-workspace-settings";
import { toast } from "@/lib/toast";

/**
 * Whether external agents may hand work to the workspace over the A2A
 * protocol. Off by default; they act with a member's own key or token.
 */
export default function WorkspaceA2aSetting({
  workspaceId,
  canEdit,
}: {
  workspaceId: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { data } = useWorkspaceSettings(workspaceId);
  const { mutate, isPending } = useUpdateWorkspaceSettings();

  const change = (allowA2a: boolean) =>
    mutate(
      { workspaceId, allowA2a },
      {
        onSuccess: () =>
          toast.success(
            allowA2a
              ? t("settings:workspaceA2a.toastOn")
              : t("settings:workspaceA2a.toastOff"),
          ),
        onError: (error) =>
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : t("settings:workspaceA2a.toastError"),
          ),
      },
    );

  return (
    <SettingsRow
      label={t("settings:workspaceA2a.label")}
      htmlFor="workspace-a2a"
      description={t("settings:workspaceA2a.description")}
    >
      <Switch
        id="workspace-a2a"
        checked={data?.allowA2a ?? false}
        disabled={!canEdit || isPending || !data}
        onCheckedChange={(checked) => change(checked)}
      />
    </SettingsRow>
  );
}
