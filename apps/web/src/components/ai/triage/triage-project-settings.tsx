import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SettingsGroup, SettingsSection } from "@/components/settings-layout";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useTriageSettings,
  useUpdateTriageSettings,
} from "@/hooks/mutations/ai/use-ai-triage";
import { toast } from "@/lib/toast";

/**
 * Project settings → Features: the Triage Copilot's opt-in to apply
 * suggested labels at once. Off by default; every change and every
 * auto-applied label is in the audit log.
 */
export default function TriageProjectSettings({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { data } = useTriageSettings(projectId);
  const update = useUpdateTriageSettings();
  const switchId = "ai-triage-auto-apply";

  return (
    <SettingsSection
      title={t("ai:triage.settings.title")}
      description={t("ai:triage.settings.description")}
    >
      <SettingsGroup>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
              <Sparkles className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor={switchId} className="font-medium text-sm">
                {t("ai:triage.settings.autoApply")}
              </Label>
              <p className="text-muted-foreground text-xs">
                {t("ai:triage.settings.autoApplyHint")}
              </p>
            </div>
          </div>
          <Switch
            id={switchId}
            checked={data?.autoApplyLabels === true}
            disabled={!canEdit || !data || update.isPending}
            onCheckedChange={(checked) =>
              update.mutate(
                { projectId, autoApplyLabels: checked },
                {
                  onSuccess: () => toast.success(t("ai:triage.settings.saved")),
                  onError: () => toast.error(t("ai:triage.settings.saveError")),
                },
              )
            }
          />
        </div>
      </SettingsGroup>
    </SettingsSection>
  );
}
