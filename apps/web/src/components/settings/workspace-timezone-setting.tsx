import { useTranslation } from "react-i18next";
import { SettingsRow } from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import useUpdateWorkspaceSettings from "@/hooks/mutations/workspace/use-update-workspace-settings";
import useWorkspaceSettings from "@/hooks/queries/workspace/use-workspace-settings";
import { browserTimeZone } from "@/lib/timezones";
import { toast } from "@/lib/toast";
import TimezoneSelect from "./timezone-select";

/**
 * The workspace time zone row. The browser's zone is only suggested; the
 * workspace keeps UTC until someone saves a zone explicitly.
 */
export default function WorkspaceTimezoneSetting({
  workspaceId,
  canEdit,
}: {
  workspaceId: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { data, isError } = useWorkspaceSettings(workspaceId);
  const { mutateAsync, isPending } = useUpdateWorkspaceSettings();
  const current = data?.timezone ?? null;
  const suggestion = browserTimeZone();

  const save = async (timezone: string) => {
    try {
      await mutateAsync({ workspaceId, timezone });
      toast.success(t("settings:timezone.toastUpdated"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:timezone.toastError"),
      );
    }
  };

  return (
    <SettingsRow
      label={t("settings:timezone.workspaceLabel")}
      htmlFor="workspace-timezone"
      description={
        isError
          ? t("settings:timezone.loadError")
          : t("settings:timezone.workspaceHint")
      }
    >
      <div className="flex w-full flex-col items-stretch gap-1.5 sm:w-64">
        <TimezoneSelect
          id="workspace-timezone"
          label={t("settings:timezone.workspaceLabel")}
          value={current}
          onChange={save}
          disabled={!canEdit || isPending || !data}
        />
        {canEdit && data && current !== suggestion && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto self-start p-0 text-xs"
            disabled={isPending}
            onClick={() => save(suggestion)}
          >
            {t("settings:timezone.useBrowser", { zone: suggestion })}
          </Button>
        )}
      </div>
    </SettingsRow>
  );
}
