import { useTranslation } from "react-i18next";
import { SettingsRow } from "@/components/settings-layout";
import { Switch } from "@/components/ui/switch";
import useUpdateWorkspaceSettings from "@/hooks/mutations/workspace/use-update-workspace-settings";
import useWorkspaceSettings from "@/hooks/queries/workspace/use-workspace-settings";
import { toast } from "@/lib/toast";

/**
 * Whether pages may be published to a public link. Off by default; turning
 * it off revokes every published link of the workspace.
 */
export default function WorkspacePublicPagesSetting({
  workspaceId,
  canEdit,
}: {
  workspaceId: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { data } = useWorkspaceSettings(workspaceId);
  const { mutate, isPending } = useUpdateWorkspaceSettings();

  const change = (allowPublicPages: boolean) =>
    mutate(
      { workspaceId, allowPublicPages },
      {
        onSuccess: () =>
          toast.success(
            allowPublicPages
              ? t("settings:workspacePublicPages.toastOn")
              : t("settings:workspacePublicPages.toastOff"),
          ),
        onError: (error) =>
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : t("settings:workspacePublicPages.toastError"),
          ),
      },
    );

  return (
    <SettingsRow
      label={t("settings:workspacePublicPages.label")}
      htmlFor="workspace-public-pages"
      description={t("settings:workspacePublicPages.description")}
    >
      <Switch
        id="workspace-public-pages"
        checked={data?.allowPublicPages ?? false}
        disabled={!canEdit || isPending || !data}
        onCheckedChange={(checked) => change(checked)}
      />
    </SettingsRow>
  );
}
